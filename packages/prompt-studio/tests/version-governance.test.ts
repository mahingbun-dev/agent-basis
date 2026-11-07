/**
 * T7.3 版本治理测试:导出包校验器逐条拒收 + 「版本只增不删」机器钉住。
 *
 * - validateExportPack:坏形状 / schemaVersion≠1 / 缺 persona|checksum /
 *   checksum 篡改 → 全部拒收(计划书 §6 T7.3「校验和不符拒收」);
 * - 版本链不可删:PromptVersionStore 原型方法面钉死(无任何删除原语),
 *   返回记录是副本(外部改写不污染库内事实),初始版本在任何写链路后仍在;
 * - 回滚链路语义:回滚=追加新版本(parentId 指向被回滚版本),旧版本原样在库。
 */
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/checksum.ts'
import { validateExportPack } from '../src/export-pack.ts'
import type { PromptExportPack } from '../src/types.ts'
import { PromptVersionStore, VERSIONS_TABLE } from '../src/version-store.ts'

function validPack(persona = '红线:预算超支>5%必须触发审批;不得代付;比选必须中立。'): PromptExportPack {
  return {
    schemaVersion: 1,
    exportedAt: '2026-11-07T03:00:00.000Z',
    exportedBy: 'alice',
    sourceVersionId: 'v-000001-abcd',
    persona,
    checksum: sha256Hex(persona),
  }
}

describe('validateExportPack(导出包 schemaVersion+checksum 强校验,T7.3 ①)', () => {
  it('合法包通过,pack 收窄为线类型(缺省元数据字段宽容为空串)', () => {
    const pack = validPack()
    const result = validateExportPack(pack)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pack.persona).toBe(pack.persona)
      expect(result.pack.checksum).toBe(pack.checksum)
      expect(result.pack.schemaVersion).toBe(1)
    }
    const minimal = validateExportPack({ schemaVersion: 1, persona: 'x', checksum: sha256Hex('x') })
    expect(minimal.ok).toBe(true)
  })

  it('非对象/数组/null/原始值 → 拒收', () => {
    for (const bad of [null, undefined, 'str', 42, true, [], ['pack']]) {
      const result = validateExportPack(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues[0]).toContain('导入包')
    }
  })

  it('schemaVersion 缺失/非 1 → 拒收(逐条 issue)', () => {
    for (const schemaVersion of [undefined, 0, 2, '1', 1.5, null]) {
      const raw = { ...validPack(), schemaVersion }
      const result = validateExportPack(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues.join('\n')).toContain('schemaVersion')
    }
  })

  it('缺 persona / 缺 checksum / 非字符串 → 拒收', () => {
    const noPersona = validateExportPack({ schemaVersion: 1, checksum: 'x' })
    expect(noPersona.ok).toBe(false)
    const noChecksum = validateExportPack({ schemaVersion: 1, persona: 'x' })
    expect(noChecksum.ok).toBe(false)
    const wrongTypes = validateExportPack({ schemaVersion: 1, persona: 7, checksum: 7 })
    expect(wrongTypes.ok).toBe(false)
  })

  it('checksum 与 persona 不配套(篡改)→ 拒收,issue 含期望/实际双值', () => {
    const pack = validPack()
    const tampered = { ...pack, persona: `${pack.persona}(被改过)` }
    const result = validateExportPack(tampered)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]).toContain('校验和不符')
      expect(result.issues[0]).toContain(pack.checksum)
      expect(result.issues[0]).toContain(sha256Hex(tampered.persona))
    }
    // checksum 大小写/空白篡改同样不符(sha256 hex 精确比对)
    const caseFlipped = { ...pack, checksum: pack.checksum.toUpperCase() }
    expect(validateExportPack(caseFlipped).ok).toBe(false)
  })

  it('persona 文本本身的问题不在本层(内容规则由 validatePersonaText 统一把守)', () => {
    // 空文本但 checksum 自洽 → 包层放行(进入写链路后按内容校验拒收)
    const empty = validPack('')
    expect(validateExportPack(empty).ok).toBe(true)
  })
})

describe('版本链不可删(T7.3 ⑥:只增不删的机器证据)', () => {
  /** 内存 KvUnit(与 version-store.test 同款最小面)。 */
  class MemoryUnit {
    readonly tables = new Map<string, Map<string, unknown>>([[VERSIONS_TABLE, new Map()]])
    async loadAll() {
      const tables: Record<string, Record<string, unknown>> = {}
      for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
      return { tables, global: null }
    }
    async putRecord(_table: string, key: string, value: unknown): Promise<void> {
      this.tables.get(VERSIONS_TABLE)?.set(key, value)
    }
    async close(): Promise<void> {}
  }

  it('原型方法面钉死:只有 append/list/get/ensureInitial/close,无任何删除原语', () => {
    const methods = Object.getOwnPropertyNames(PromptVersionStore.prototype)
      .filter(name => name !== 'constructor')
      .sort()
    expect(methods).toEqual(['append', 'close', 'ensureInitial', 'get', 'list'])
    for (const banned of ['delete', 'remove', 'clear', 'drop', 'purge', 'unlink', 'destroy', 'truncate']) {
      expect(methods).not.toContain(banned)
    }
  })

  it('写链路全走一遍后初始版本仍在、总数只增;返回记录是副本(改写不污染库内)', async () => {
    const store = new PromptVersionStore(new MemoryUnit() as never)
    const initial = await store.ensureInitial('初始基线')
    expect(initial).not.toBeNull()
    await store.append({ content: '第二版', author: 'a', source: 'save', parentId: initial?.id ?? null, summary: '' })
    const rollback = await store.append({ content: '初始基线', author: 'b', source: 'rollback', parentId: initial?.id ?? null, summary: '回滚' })
    expect(rollback.parentId).toBe(initial?.id)
    // 初始版本永久保留
    expect((await store.get(initial?.id ?? ''))?.content).toBe('初始基线')
    expect((await store.list()).map(record => record.source)).toEqual(['rollback', 'save', 'initial'])
    // 返回记录是副本:外部改写不影响库内事实
    const fetched = await store.get(initial?.id ?? '')
    if (fetched) (fetched as { content: string }).content = '外部篡改'
    expect((await store.get(initial?.id ?? ''))?.content).toBe('初始基线')
    await store.close()
  })
})
