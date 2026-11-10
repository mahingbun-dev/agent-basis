/**
 * T2.3 会话快照单测(测试计划 §4 T2.3(b) + §6.7 快照不可变性横切):
 * - 快照库(独立 json 单元,版本库先例):方法面钉死(无删除/改写原语)、
 *   append/list/get/getBySessionId、同 sessionId 二次 append fail-closed;
 * - 捕获纯函数:指针按条目型别分语义(patch 值型=entryId→versionId 且内容
 *   checksum 一致才指;行锚点只读型=在场标记+「上游运行时生成」标注不伪造;
 *   运行时注入型=可解析文本或在场标记);
 * - 网关链路:session/created → 快照入 DSH_HOME 语义存储(内存 KvUnit)→
 *   session-snapshot 端点按会话查询(三型条目结构化结果,两型无版本链不炸不空段);
 * - 不可变性(§6.7 核心):改提示词(保存/回滚/导入)后已存快照逐字节不变
 *   (checksum 复核);写入并发开会话 → 指针与文本由同一 checksum 绑定,
 *   不出现「指针指向 v1、文本是 v2」的混合版本;
 * - 事件接线:registerSessionCreated(真实 cordis Context,ctx.emit 投递)+
 *   插件源码接线钉住(definePromptStudioPlugin 内调用,源码文本断言)。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import plugin, {
  LoopPromptGateway, PROMPT_REGISTRY_ENTRIES, SESSION_CREATED_EVENT, SessionSnapshotStore,
  SNAPSHOTS_TABLE, SNAPSHOT_UNIT_DESCRIPTOR, SNAPSHOT_UNIT_NAME, VERSION_UNIT_NAME,
  captureSessionSnapshotEntries, sessionSnapshotChecksum,
} from '../src/index.ts'
import type {
  SessionSnapshotEntry, SessionSnapshotGetResult, SessionSnapshotListResult,
  SessionSnapshotNotFoundResult, SessionSnapshotUnavailableResult, StudioContextLike,
} from '../src/types.ts'
import { VERSIONS_TABLE } from '../src/version-store.ts'
import { createHash } from 'node:crypto'

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** 内存 KvUnit(双表:versions + snapshots;putRecord 带 1ms 交错窗口,并发写竞争可见)。 */
class MemoryUnit {
  readonly tables = new Map<string, Map<string, unknown>>([
    [VERSIONS_TABLE, new Map()],
    [SNAPSHOTS_TABLE, new Map()],
  ])
  writeCount = 0

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: null }> {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
    return { tables, global: null }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.writeCount += 1
    await new Promise(resolve => setTimeout(resolve, 1))
    const records = this.tables.get(table)
    if (records === undefined) throw new Error(`no table ${table}`)
    records.set(key, value)
  }

  async close(): Promise<void> {}
}

/** 基线 persona(含标准三条红线锚点,可过保存校验)。 */
const PERSONA_V1 = 'You are the Eterna enterprise assistant. T2.3 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
const RED_LINES = '红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'

/** live patch:preset-standard 全行(persona 裸标量/plan-mode | 块/time-context 裸行)。 */
function livePatch(): string {
  return [
    '# T2.3 fixture:preset-standard 全行',
    '- id: preset-standard',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    `          prefix: '${PERSONA_V1}'`,
    '      - id: time-context',
    "        name: '@deepseek-ai/dsh-time-context'",
    '      - id: planning',
    "        name: '@deepseek-ai/dsh-planning'",
    '        config:',
    '          plugins:',
    '            - id: plan-mode',
    "              name: '@deepseek-ai/dsh-plan-mode'",
    '              config:',
    '                section: |',
    '                  You are in plan mode. Stay in plan mode.',
    '',
  ].join('\n')
}

/** 领域 fixture 仓库根(event-planning 形态 A >- 块 + persona.md 整文件)。 */
function seedFixtureRepo(repoRoot: string): void {
  const prefix = 'You are a senior event planning specialist. Never silently exceed budgets, never make or promise external payments, stay neutral in vendor selection.'
  mkdirSync(join(repoRoot, 'packs/event-planning'), { recursive: true })
  writeFileSync(join(repoRoot, 'packs/event-planning/cordis.patch.yml'), [
    '# fixture event pack patch',
    '- id: system-prompt',
    '  config:',
    '    personaPrefix: >-',
    `      ${prefix}`,
    '',
  ].join('\n'), 'utf8')
  writeFileSync(join(repoRoot, 'packs/event-planning/persona.md'), `# persona\n\n${prefix}\n`, 'utf8')
}

describe('快照库单元描述符(独立 json 单元,版本库先例)', () => {
  it('per-record 布局、单元/表名合法且与版本库单元分离', () => {
    expect(SNAPSHOT_UNIT_DESCRIPTOR.name).toBe(SNAPSHOT_UNIT_NAME)
    expect(SNAPSHOT_UNIT_DESCRIPTOR.layout).toBe('per-record')
    expect(SNAPSHOT_UNIT_DESCRIPTOR.tables).toEqual([SNAPSHOTS_TABLE])
    expect(SNAPSHOT_UNIT_NAME).toMatch(/^[a-z][a-z0-9_]*$/u)
    expect(SNAPSHOTS_TABLE).toMatch(/^[a-z][a-z0-9_]*$/u)
    // 独立单元:不与版本库共用表(误开同名单元会撞描述符版本)。
    expect(SNAPSHOT_UNIT_NAME).not.toBe(VERSION_UNIT_NAME)
  })
})

describe('SessionSnapshotStore(只增不改 + 单写者串行)', () => {
  it('原型方法面钉死:只有 append/get/getBySessionId/list/close,无任何删除/改写原语(§6.7②)', () => {
    const methods = Object.getOwnPropertyNames(SessionSnapshotStore.prototype)
      .filter(name => name !== 'constructor')
      .sort()
    expect(methods).toEqual(['append', 'close', 'get', 'getBySessionId', 'list'])
    for (const banned of ['delete', 'remove', 'clear', 'drop', 'purge', 'unlink', 'destroy', 'truncate', 'update', 'put']) {
      expect(methods, `禁止出现的原语 ${banned}`).not.toContain(banned)
    }
  })

  it('append→list/get/getBySessionId 往返;记录字段齐全(checksum=规范化载荷 sha256,id path-safe)', async () => {
    const store = new SessionSnapshotStore(new MemoryUnit() as unknown as KvUnit, {
      now: () => new Date('2026-11-11T00:00:00Z'),
      idFactory: () => 'ss-fixed001',
    })
    const entries = [{
      entryId: 'preset.standard.persona', layer: 'preset' as const, kind: 'patch-value' as const,
      text: PERSONA_V1, bytes: Buffer.byteLength(PERSONA_V1, 'utf8'), checksum: sha256(PERSONA_V1),
      versionId: 'v-1', annotation: null, problems: [],
    }]
    const record = await store.append({ sessionId: 'session-aaa', trigger: 'session/created', entries })
    expect(record.id).toBe('ss-fixed001')
    expect(record.createdAt).toBe('2026-11-11T00:00:00.000Z')
    expect(record.checksum).toBe(sessionSnapshotChecksum('session-aaa', 'session/created', entries))
    expect(record.id).toMatch(/^[A-Za-z0-9_-]+$/u)
    expect((await store.getBySessionId('session-aaa'))?.id).toBe(record.id)
    expect((await store.get(record.id))?.sessionId).toBe('session-aaa')
    expect((await store.list())).toHaveLength(1)
    await store.close()
  })

  it('同 sessionId 二次 append fail-closed 抛错,原快照不被覆盖(只增不改)', async () => {
    const unit = new MemoryUnit()
    const store = new SessionSnapshotStore(unit as unknown as KvUnit)
    const first = await store.append({ sessionId: 'session-dup', trigger: 'session/created', entries: [] })
    await expect(store.append({ sessionId: 'session-dup', trigger: 'session/created', entries: [] }))
      .rejects.toThrow('已有快照')
    // 原快照原样在场(未被静默覆盖)。
    expect(await store.getBySessionId('session-dup')).toEqual(first)
    expect((await store.list())).toHaveLength(1)
    await store.close()
  })

  it('并发 append(不同会话)全部落库(单写者串行,无丢写);列表新→旧', async () => {
    const store = new SessionSnapshotStore(new MemoryUnit() as unknown as KvUnit)
    const writes = Array.from({ length: 12 }, (_, i) =>
      store.append({ sessionId: `session-n${i}`, trigger: 'session/created', entries: [] }))
    await Promise.all(writes)
    const listed = await store.list()
    expect(listed).toHaveLength(12)
    expect(new Set(listed.map(record => record.sessionId)).size).toBe(12)
    const sorted = [...listed].map(record => record.createdAt).sort((a, b) => (a < b ? 1 : -1))
    expect(listed.map(record => record.createdAt)).toEqual(sorted)
    await store.close()
  })
})

describe('捕获纯函数 captureSessionSnapshotEntries(指针按条目型别分语义)', () => {
  let dir: string
  let repoRoot: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-ps-capture-'))
    repoRoot = join(dir, 'repo')
    mkdirSync(repoRoot, { recursive: true })
    writeFileSync(join(dir, 'cordis.patch.yml'), livePatch(), 'utf8')
    seedFixtureRepo(repoRoot)
  })

  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('分型语义全集:patch 值型(指针/无指针)、行锚点只读型(在场标记)、运行时注入型(文本/在场标记)', () => {
    const files = new Map<string, string>()
    const readFileFn = (file: string) => {
      const text = files.get(file)
      if (text === undefined) throw new Error(`ENOENT ${file}`)
      return text
    }
    // live patch + 领域 fixture 文件装进内存读取面。
    files.set('profiles/eterna-web/cordis.patch.yml', livePatch())
    files.set('packs/event-planning/cordis.patch.yml', readFileSync(join(repoRoot, 'packs/event-planning/cordis.patch.yml'), 'utf8'))
    files.set('packs/event-planning/persona.md', readFileSync(join(repoRoot, 'packs/event-planning/persona.md'), 'utf8'))
    const personaEntry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'preset.standard.persona')!
    const domainEntry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'domain.event-planning.persona-prefix')!
    const readonlyEntry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'preset.standard.time-context')!
    const runtimeEntry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'runtime.memory.index-section')!
    // 版本链:persona 现值已入库(v-p1);多版本时取内容 checksum 一致者(新→旧首个)。
    const versionRecords = [
      { entryId: 'preset.standard.persona', id: 'v-p1', checksum: sha256(PERSONA_V1), content: PERSONA_V1, seq: 1 },
      { entryId: 'preset.standard.persona', id: 'v-p0', checksum: sha256('更旧版本'), content: '更旧版本', seq: 0 },
    ] as never

    const captured = captureSessionSnapshotEntries({
      entries: [personaEntry, domainEntry, readonlyEntry, runtimeEntry],
      readFile: readFileFn,
      versionRecords,
      runtimeTexts: new Map([['runtime.memory.index-section', '## 记忆索引(注册表版)']]),
    })
    const byId = new Map(captured.map(item => [item.entryId, item]))
    // ① patch 值型 + 一致版本 → 指针即该版本;checksum 口径同 version-store。
    const persona = byId.get('preset.standard.persona')!
    expect(persona.text).toBe(PERSONA_V1)
    expect(persona.checksum).toBe(sha256(PERSONA_V1))
    expect(persona.bytes).toBe(Buffer.byteLength(PERSONA_V1, 'utf8'))
    expect(persona.versionId).toBe('v-p1')
    expect(persona.annotation).toBeNull()
    // ② patch 值型 + 链上无一致版本(领域条目未种子)→ versionId=null + 明示,不伪造。
    const domain = byId.get('domain.event-planning.persona-prefix')!
    expect(domain.text).toContain('senior event planning specialist')
    expect(domain.versionId).toBeNull()
    expect(domain.annotation).toContain('不伪造版本指针')
    // ③ 行锚点只读型:在场标记 +「上游运行时生成」标注,不伪造 versionId。
    const readonlyItem = byId.get('preset.standard.time-context')!
    expect(readonlyItem.kind).toBe('line-anchor-readonly')
    expect(readonlyItem.text).toBeNull()
    expect(readonlyItem.versionId).toBeNull()
    expect(readonlyItem.annotation).toContain('上游运行时生成')
    // ④ 运行时注入型:开启时可解析的 section 文本(注册表自管)→ 文本+checksum。
    const runtime = byId.get('runtime.memory.index-section')!
    expect(runtime.text).toBe('## 记忆索引(注册表版)')
    expect(runtime.checksum).toBe(sha256('## 记忆索引(注册表版)'))
    expect(runtime.versionId).toBeNull()
    expect(runtime.annotation).toContain('运行时注入')
    // ⑤ 运行时注入型无文本 → 元数据在场标记(空段冒充禁止:text=null+标注在场)。
    const runtimeEmpty = captureSessionSnapshotEntries({
      entries: [runtimeEntry], readFile: readFileFn, versionRecords: [], runtimeTexts: new Map(),
    })[0]!
    expect(runtimeEmpty.text).toBeNull()
    expect(runtimeEmpty.annotation).toContain('在场标记')
  })

  it('读值失败(patch 值型定位失败):text=null + problems 明示,不冒充空内容', () => {
    const personaEntry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'preset.standard.persona')!
    const captured = captureSessionSnapshotEntries({
      entries: [personaEntry],
      readFile: () => '- id: other\n  config: {}\n',
      versionRecords: [],
      runtimeTexts: new Map(),
    })[0]!
    expect(captured.text).toBeNull()
    expect(captured.versionId).toBeNull()
    expect(captured.annotation).toContain('读值失败')
    expect(captured.problems.length).toBeGreaterThan(0)
  })
})

/**
 * 网关链路(session/created → 快照入库 → session-snapshot 端点);
 * 真实 cordis 根 Context(与 host-plugin.test 同款),storage 经 MemoryUnit。
 */
describe('T2.3 网关链路:会话开启事件 → 快照存储 → 查询端点', () => {
  let dir: string
  let repoRoot: string
  let patchPath: string
  let auditPath: string
  let unit: MemoryUnit
  let gateway: LoopPromptGateway

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-ps-snapshot-'))
    repoRoot = join(dir, 'repo')
    patchPath = join(dir, 'cordis.patch.yml')
    auditPath = join(dir, 'audit.jsonl')
    seedFixtureRepo(repoRoot)
    writeFileSync(patchPath, livePatch(), 'utf8')
    unit = new MemoryUnit()
    const ctx = new Context()
    gateway = new LoopPromptGateway(ctx as unknown as StudioContextLike, {
      patchPath, auditFilePath: auditPath, dryRunVerify: false, repoRoot,
      sessionsRoot: join(dir, 'sessions'),
    })
  })

  afterEach(async () => {
    await gateway.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  async function attach(): Promise<void> {
    const backend = { kv: { open: async () => unit as unknown as KvUnit }, close: async () => undefined }
    await gateway.attachBackend(backend)
  }

  /** 审计明细(轮询等待异步落盘;host-plugin.test waitForAudit 同款)。 */
  async function auditDetails(): Promise<Array<Record<string, unknown>>> {
    for (let waited = 0; waited < 2000; waited += 10) {
      try {
        return readFileSync(auditPath, 'utf8').split('\n').filter(Boolean)
          .map(line => (JSON.parse(line) as { detail?: Record<string, unknown> }).detail ?? {})
      } catch {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    return []
  }

  /** 两段式保存(便捷封装,断言 committed)。 */
  async function saveTwoPhase(entryId: string | undefined, content: string, author = 'alice') {
    const phase1 = await gateway.promptSave({ ...(entryId !== undefined ? { entryId } : {}), content, author })
    expect(phase1.status, `一段应 approval-required:${JSON.stringify(phase1.issues ?? '')}`).toBe('approval-required')
    const phase2 = await gateway.promptSave({
      ...(entryId !== undefined ? { entryId } : {}), content, author,
      approvalId: phase1.approval?.approvalId ?? '', approved: true,
    })
    expect(phase2.status, `二段应 committed:${JSON.stringify(phase2.issues)}`).toBe('committed')
    return phase2
  }

  it('会话开启 → 快照入库(全景条目,三型分语义)→ 端点按会话返回当时 effective prompt', async () => {
    await attach()
    const personaInitial = (await gateway.promptVersions({})).versions[0]
    gateway.handleSessionCreated({ id: 'session-t23-a' })
    await gateway.drainSessionCaptures()
    const result = await gateway.sessionSnapshot({ sessionId: 'session-t23-a' }) as SessionSnapshotGetResult
    expect(result.status).toBe('ok')
    const snapshot = result.snapshot
    expect(snapshot.sessionId).toBe('session-t23-a')
    expect(snapshot.trigger).toBe('session/created')
    expect(snapshot.entries).toHaveLength(PROMPT_REGISTRY_ENTRIES.length)
    const byId = new Map(snapshot.entries.map((item: SessionSnapshotEntry) => [item.entryId, item] as const))
    // patch 值型:当时文本 + 版本指针(=开启时内容一致的 initial 版本)。
    const persona = byId.get('preset.standard.persona') as SessionSnapshotEntry
    expect(persona.text).toBe(PERSONA_V1)
    expect(persona.versionId).toBe(personaInitial?.id)
    expect(persona.checksum).toBe(sha256(PERSONA_V1))
    // 行锚点只读型/运行时注入型:结构化结果(在场标记),不炸不空段冒充。
    expect((byId.get('preset.standard.time-context') as SessionSnapshotEntry).annotation).toContain('上游运行时生成')
    expect((byId.get('runtime.memory.index-section') as SessionSnapshotEntry).annotation).toContain('在场标记')
    expect([...byId.values()].every(item => item.kind !== 'patch-value' || item.text !== null || item.problems.length > 0)).toBe(true)
    // 查看语义说明在场(不可回放条目明示)。
    expect(result.note).toContain('不可回放')
    // 审计留痕(异步落盘,轮询等待)。
    const details = await auditDetails()
    const captured = details.find(detail => detail['action'] === 'session-snapshot.captured')
    expect(captured?.['sessionId']).toBe('session-t23-a')
  })

  it('sessionId 兼容目录名形态:`<id>` 与 `session-<id>` 同查;列表模式新→旧', async () => {
    await attach()
    gateway.handleSessionCreated({ id: 'session-form1' })
    gateway.handleSessionCreated({ id: 'session-form2' })
    await gateway.drainSessionCaptures()
    const bare = await gateway.sessionSnapshot({ sessionId: 'form1' }) as SessionSnapshotGetResult
    expect(bare.status).toBe('ok')
    expect(bare.snapshot.sessionId).toBe('session-form1')
    const list = await gateway.sessionSnapshot({}) as SessionSnapshotListResult
    expect(list.status).toBe('ok')
    expect(list.ready).toBe(true)
    expect(list.total).toBe(2)
    expect(new Set(list.snapshots.map(item => item.sessionId)))
      .toEqual(new Set(['session-form2', 'session-form1']))
    expect(list.snapshots[0]?.entries).toBe(PROMPT_REGISTRY_ENTRIES.length)
  })

  it('未知 sessionId → status=not-found 明示,不抛裸异常;重复开启事件幂等(单快照)', async () => {
    await attach()
    const missing = await gateway.sessionSnapshot({ sessionId: 'session-nope' }) as SessionSnapshotNotFoundResult
    expect(missing.status).toBe('not-found')
    expect(missing.issues[0]).toContain('无快照')
    // 幂等:同一会话事件重放 → 仍只有一份快照(内存集 + 库侧 fail-closed 双守卫)。
    gateway.handleSessionCreated({ id: 'session-idem' })
    gateway.handleSessionCreated({ id: 'session-idem' })
    await gateway.drainSessionCaptures()
    const list = await gateway.sessionSnapshot({}) as SessionSnapshotListResult
    expect(list.status).toBe('ok')
    expect(list.total).toBe(1)
  })

  it('storage 缺席降级(§6.5③):列表 ready=false、按会话 unavailable,均不 5xx 不抛', async () => {
    const list = await gateway.sessionSnapshot({}) as SessionSnapshotListResult
    expect(list.status).toBe('ok')
    expect(list.ready).toBe(false)
    expect(list.total).toBe(0)
    expect(list.snapshots).toEqual([])
    const get = await gateway.sessionSnapshot({ sessionId: 'session-any' }) as SessionSnapshotUnavailableResult
    expect(get.status).toBe('unavailable')
    expect(get.issues[0]).toContain('会话快照存储未挂载')
  })

  it('会话开启先于快照库挂载:队列保底,attach 后补捕(新会话开启即有快照)', async () => {
    // 未 attach 前会话开启 → 入队保底;attach 完成后自动补捕。
    gateway.handleSessionCreated({ id: 'session-early' })
    expect(gateway.pendingCaptureSessions).toContain('session-early')
    await attach()
    await gateway.drainSessionCaptures()
    const result = await gateway.sessionSnapshot({ sessionId: 'session-early' }) as SessionSnapshotGetResult
    expect(result.status).toBe('ok')
  })

  it('载荷防御:无字符串 id 的事件跳过捕获并审计,不炸(上游同步边界安全)', async () => {
    await attach()
    gateway.handleSessionCreated(undefined)
    gateway.handleSessionCreated({ id: 42 })
    gateway.handleSessionCreated({ id: '' })
    await gateway.drainSessionCaptures()
    const list = await gateway.sessionSnapshot({}) as SessionSnapshotListResult
    expect(list.status).toBe('ok')
    expect(list.total).toBe(0)
    const details = await auditDetails()
    const rejected = details.filter(detail => detail['action'] === 'session-snapshot.rejected')
    expect(rejected.length).toBeGreaterThanOrEqual(2)
  })

  it('§6.7①⑤ 快照不可变:保存/回滚/导入写操作后,已存快照逐字节不变(checksum 复核)', async () => {
    await attach()
    gateway.handleSessionCreated({ id: 'session-immutable' })
    await gateway.drainSessionCaptures()
    const before = await gateway.sessionSnapshot({ sessionId: 'session-immutable' }) as SessionSnapshotGetResult
    expect(before.status).toBe('ok')
    const beforeRecord = before.snapshot
    // 保存 v2 → 回滚 v1 → 导入 v3(三种写操作全走一遍)。
    await saveTwoPhase(undefined, `${PERSONA_V1}\nv2 写后快照不变`)
    const chain = await gateway.promptVersions({})
    await (async () => {
      const phase1 = await gateway.promptRollback({ versionId: chain.versions.at(-1)?.id ?? '', author: 'bob' })
      expect(phase1.status).toBe('approval-required')
      const phase2 = await gateway.promptRollback({
        versionId: chain.versions.at(-1)?.id ?? '', author: 'bob', approvalId: phase1.approval?.approvalId ?? '', approved: true,
      })
      expect(phase2.status).toBe('committed')
    })()
    const v3 = `${PERSONA_V1}\n导入写后快照不变 ${RED_LINES}`
    const exported = await gateway.promptExport({ exportedBy: 'carol' })
    const importPack = { ...exported.pack, persona: v3, checksum: sha256(v3) }
    const importPhase1 = await gateway.promptImport({ pack: importPack, author: 'carol' })
    expect(importPhase1.status).toBe('approval-required')
    const importPhase2 = await gateway.promptImport({
      pack: importPack, author: 'carol', approvalId: importPhase1.approval?.approvalId ?? '', approved: true,
    })
    expect(importPhase2.status).toBe('committed')
    // 版本链确已前进(写操作真实发生)。
    expect((await gateway.promptVersions({})).total).toBeGreaterThanOrEqual(4)
    // 已存快照:记录逐字节不变 + checksum 复核一致 + 内容 checksum 重算一致。
    const after = await gateway.sessionSnapshot({ sessionId: 'session-immutable' }) as SessionSnapshotGetResult
    expect(after.status).toBe('ok')
    expect(after.snapshot).toEqual(beforeRecord)
    expect(after.snapshot.checksum).toBe(beforeRecord.checksum)
    expect(after.snapshot.checksum)
      .toBe(sessionSnapshotChecksum(after.snapshot.sessionId, after.snapshot.trigger, after.snapshot.entries))
    const personaAfter = after.snapshot.entries.find(item => item.entryId === 'preset.standard.persona') as SessionSnapshotEntry
    expect(personaAfter.text).toBe(PERSONA_V1)
  })

  it('§6.7④ 写入并发开会话:快照条目要么全旧要么全新(指针与文本同一 checksum 绑定,不混合)', async () => {
    await attach()
    const contents = [PERSONA_V1]
    for (let round = 0; round < 6; round += 1) {
      const next = `${PERSONA_V1}\n并发轮次 ${round} ${RED_LINES}`
      contents.push(next)
      const sessionId = `session-race-${round}`
      // 捕获(排空)与治理写并发发起:读文件面与版本链 append 在时间上交错。
      gateway.handleSessionCreated({ id: sessionId })
      const drained = gateway.drainSessionCaptures()
      const saved = saveTwoPhase(undefined, next)
      await Promise.all([drained, saved])
      await gateway.drainSessionCaptures()
    }
    // 全部轮次快照在场;逐条目校验不变量。
    const chain = (await gateway.promptVersions({})).versions
    const versionByChecksum = new Map(chain.map(record => [record.checksum, record.content] as const))
    for (let round = 0; round < 6; round += 1) {
      const result = await gateway.sessionSnapshot({ sessionId: `session-race-${round}` }) as SessionSnapshotGetResult
      expect(result.status, `session-race-${round} 快照应在场`).toBe('ok')
      const persona = result.snapshot.entries.find(item => item.entryId === 'preset.standard.persona') as SessionSnapshotEntry
      // 文本恰为某一版全文(旧或新,绝无混合/撕裂)。
      expect(contents).toContain(persona.text)
      // 指针不变量:versionId 非空 ⇒ 指向内容的 checksum == 文本 checksum(不出现指针 v1/文本 v2)。
      if (persona.versionId !== null) {
        expect(persona.checksum).not.toBeNull()
        const checksum = persona.checksum as string
        expect(checksum).toBe(sha256(persona.text ?? ''))
        const pointed = chain.find(record => record.id === persona.versionId)
        expect(pointed, `指针 ${persona.versionId} 须在版本链`).toBeDefined()
        expect(pointed?.content).toBe(persona.text)
        expect(versionByChecksum.get(checksum)).toBe(persona.text)
      } else {
        // 无一致版本指针 → annotation 明示(不伪造)。
        expect(persona.annotation).toContain('不伪造版本指针')
      }
    }
  })

  it('事件接线:registerSessionCreated(真实 cordis Context)——ctx.emit 投递 session/created 即捕获', async () => {
    await attach()
    const ctx = new Context()
    const dispose = gateway.registerSessionCreated(ctx as unknown as StudioContextLike)
    expect(typeof dispose).toBe('function')
    // 事件面按 StudioContextLike 鸭子形态调用(cordis 声明面把 session/created 载荷
    // 钉成 branded Session;本测试投递的是运行时事实载荷——监听器防御式读 id)。
    const emit = (ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit
    emit(SESSION_CREATED_EVENT, { id: 'session-emit' })
    await gateway.drainSessionCaptures()
    const result = await gateway.sessionSnapshot({ sessionId: 'session-emit' }) as SessionSnapshotGetResult
    expect(result.status).toBe('ok')
    dispose()
    // 撤销后不再捕获。
    emit(SESSION_CREATED_EVENT, { id: 'session-after-dispose' })
    await gateway.drainSessionCaptures()
    const gone = await gateway.sessionSnapshot({ sessionId: 'session-after-dispose' }) as SessionSnapshotNotFoundResult
    expect(gone.status).toBe('not-found')
  })

  it('插件源码接线钉住:definePromptStudioPlugin 内注册 session/created 监听并随 disposer 撤销', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8')
    expect(source).toContain('gateway.registerSessionCreated(ctx)')
    expect(source).toContain('disposeSessionCreated()')
    // default export 插件 apply/disposer 形态不回归(host-plugin.test 同款口径)。
    expect(plugin.name).toBe('eterna-prompt-studio')
  })
})
