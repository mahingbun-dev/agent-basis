/**
 * Host 半边插件测试(T7.1):
 * - 8 个 SRC 端点的 @Remote marker(手工施加路径)与端点字符串;
 * - default export 插件形态(name/apply/总 disposer);
 * - 全写链路在进程内打通:approval-required → confirm → committed(patch 原子写 +
 *   版本库追加 + 审计留痕),回滚/导入/乐观锁/校验拒绝/storage 未就绪分支。
 *
 * 真实 cordis Context(裸根):profileContext 缺席 → patchPath/审计/会话根全部走
 * 插件 config 覆写(与宿主 profileContext 提供时的缺省路径同构)。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import plugin, {
  ENDPOINTS, LOOP_PROMPT_SERVICE_ID, LoopPromptGateway, STORAGE_JSON_BACKEND_KEY, definePromptStudioPlugin,
} from '../src/index.ts'
import type { PromptExportPack, StudioContextLike } from '../src/types.ts'
import { PersonaPatchFile } from '../src/persona-patch.ts'
import { VERSIONS_TABLE } from '../src/version-store.ts'
import { sha256Hex } from '../src/checksum.ts'

/** 基线 persona(单行;T7.3 起内含三条红线锚点,对齐 packs/event-planning persona 全局硬约束)。 */
const PERSONA_V1 = 'You are the Basis enterprise assistant. T7-STUDIO-V1 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
/** 三条红线锚点文本(拼接新内容用)。 */
const RED_LINES = '红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'

/** 内存 KvUnit(与 version-store.test 同款最小面)。 */
class MemoryUnit {
  readonly tables = new Map<string, Map<string, unknown>>([[VERSIONS_TABLE, new Map()]])
  async loadAll() {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
    return { tables, global: null }
  }
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.tables.get(table)?.set(key, value)
  }
  async close(): Promise<void> {}
}

function fixturePatch(persona: string = PERSONA_V1): string {
  return [
    '# fixture profile patch',
    '- id: preset-standard',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    `          prefix: '${persona}'`,
    '',
  ].join('\n')
}

/** 测试边界:真实 cordis Context → 本包结构面(同一运行时对象,types.ts StudioContextLike 注)。 */
function asStudio(ctx: Context): StudioContextLike {
  return ctx as unknown as StudioContextLike
}

describe('SRC 端点声明(手工 @Remote marker)', () => {
  const markers = remoteMethods(Object.create(LoopPromptGateway.prototype) as object)

  it('8 个端点,exportName 与请求路径一一对应', () => {
    expect(markers).toHaveLength(8)
    const names = markers.map(marker => marker.exportName ?? marker.method).sort()
    expect(names).toEqual([
      'prompt-export', 'prompt-get', 'prompt-import', 'prompt-rollback', 'prompt-save', 'prompt-versions', 'snapshot', 'trace',
    ])
  })

  it('ENDPOINTS 字符串 = loopPrompt/<method>', () => {
    expect(LOOP_PROMPT_SERVICE_ID).toBe('loopPrompt')
    expect(ENDPOINTS.snapshot).toBe('loopPrompt/snapshot')
    expect(ENDPOINTS.trace).toBe('loopPrompt/trace')
    expect(ENDPOINTS.promptGet).toBe('loopPrompt/prompt-get')
    expect(ENDPOINTS.promptSave).toBe('loopPrompt/prompt-save')
    expect(ENDPOINTS.promptVersions).toBe('loopPrompt/prompt-versions')
    expect(ENDPOINTS.promptRollback).toBe('loopPrompt/prompt-rollback')
    expect(ENDPOINTS.promptExport).toBe('loopPrompt/prompt-export')
    expect(ENDPOINTS.promptImport).toBe('loopPrompt/prompt-import')
  })

  it('json backend 服务键来自官方 storageBackendServiceKey', () => {
    expect(STORAGE_JSON_BACKEND_KEY).toBe('storage.backend.json')
  })
})

describe('default export 插件形态(DSH bundle loader 契约)', () => {
  it('name 与 apply(返回 disposer);工厂与 default 实例同构', () => {
    expect(plugin.name).toBe('basis-prompt-studio')
    expect(typeof plugin.apply).toBe('function')
    const built = definePromptStudioPlugin()
    expect(built.name).toBe('basis-prompt-studio')
    expect(typeof built.apply).toBe('function')
    const ctx = new Context()
    const disposer = plugin.apply(asStudio(ctx))
    expect(typeof disposer).toBe('function')
    disposer()
  })
})

describe('LoopPromptGateway 全链路(真实 cordis 根 Context)', () => {
  let dir: string
  let patchPath: string
  let auditPath: string
  let sessionsRoot: string
  let unit: MemoryUnit
  let gateway: LoopPromptGateway

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'basis-prompt-studio-host-'))
    patchPath = join(dir, 'cordis.patch.yml')
    auditPath = join(dir, 'audit.jsonl')
    sessionsRoot = join(dir, 'sessions')
    writeFileSync(patchPath, fixturePatch(), 'utf8')
    unit = new MemoryUnit()
    const ctx = new Context()
    gateway = new LoopPromptGateway(asStudio(ctx), { patchPath, sessionsRoot, auditFilePath: auditPath, dryRunVerify: false })
  })

  afterEach(async () => {
    await gateway.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  function attach(): Promise<void> {
    const backend = { kv: { open: async () => unit as unknown as KvUnit }, close: async () => undefined }
    return gateway.attachBackend(backend)
  }

  it('attach 前:promptVersions 以 RemoteError(bad-request) 明示未就绪', async () => {
    const error = await gateway.promptVersions({}).catch((cause: unknown) => cause)
    expect(remoteErrorOf(error)?.code).toBe('gateway/bad-request')
  })

  it('promptGet:persona 现值 + 生效说明 + 组合说明', async () => {
    const result = await gateway.promptGet()
    expect(result.persona.available).toBe(true)
    expect(result.persona.text).toBe(PERSONA_V1)
    expect(result.persona.patchPath).toBe(patchPath)
    expect(result.versions.ready).toBe(false)
    expect(result.effectiveNote).toContain('新会话生效')
    expect(result.effectiveNote).toContain('KV-cache')
    expect(result.composedNote).toContain('T7.2')
  })

  it('attachBackend:打开单元并种子 initial 版本(基线=patch 现值)', async () => {
    await attach()
    const versions = await gateway.promptVersions({})
    expect(versions.ready).toBe(true)
    expect(versions.total).toBe(1)
    expect(versions.versions[0]?.source).toBe('initial')
    expect(versions.versions[0]?.content).toBe(PERSONA_V1)
  })

  it('snapshot:未挂载降级 ready=false;挂载后 ready=true + 通道 A', async () => {
    const before = await gateway.snapshot()
    expect(before.versions.ready).toBe(false)
    expect(before.pendingApproval).toBeNull()
    expect(before.channel.kind).toBe('A-patch-hmr')
    expect(before.trace.pipeline).toBe('v0-disk-log')
    await attach()
    const after = await gateway.snapshot()
    expect(after.versions.ready).toBe(true)
    expect(after.versions.count).toBe(1)
  })

  it('两段式保存:审批卡 → 确认 → patch 更新 + 版本 +2 + 审计含 operator/versionId', async () => {
    await attach()
    const next = `${PERSONA_V1}\n新增红线行`
    const phase1 = await gateway.promptSave({ content: next, author: 'alice', summary: '加红线' })
    expect(phase1.status).toBe('approval-required')
    expect(phase1.approval?.card.matchedRule.grade).toBe('R3')
    expect(phase1.approval?.questionItems).toHaveLength(2)
    expect(phase1.effectiveNote).toContain('新会话生效')
    // patch 未被写(仍在途)
    expect(readFileSync(patchPath, 'utf8')).toContain(PERSONA_V1)
    expect(readFileSync(patchPath, 'utf8')).not.toContain('新增红线行')
    // 审批卡 diffSummary 出现在卡片影响面(新增一行)
    expect(phase1.approval?.card.impact.files[0]?.diffSummary).toBe('+1/-0 行')
    // 复述不一致 → mismatch,不执行
    const mismatch = await gateway.promptSave({ content: '别的内容', approvalId: phase1.approval?.approvalId ?? '', approved: true })
    expect(mismatch.status).toBe('approval-mismatch')
    // 正确确认 → committed
    const v1Id = (await gateway.promptVersions({})).versions[0]?.id
    const phase2 = await gateway.promptSave({
      content: next, author: 'alice', approvalId: phase1.approval?.approvalId ?? '', approved: true,
    })
    expect(phase2.status).toBe('committed')
    expect(phase2.version?.source).toBe('save')
    expect(phase2.version?.seq).toBe(2)
    expect(phase2.version?.author).toBe('alice')
    expect(phase2.version?.checksum).toBe(sha256Hex(next))
    expect(phase2.version?.parentId).toBe(v1Id)
    // 版本列表新→旧:最新即刚提交的版本
    expect((await gateway.promptVersions({})).versions[0]?.id).toBe(phase2.version?.id)
    // patch 已原子更新
    const state = await new PersonaPatchFile(patchPath).read()
    expect(state.text).toBe(next)
    // 审计留痕:NDJSON 含 approval-requested 与 committed(operator/versionId)
    const lines = readFileSync(auditPath, 'utf8').split('\n').filter(line => line.trim().length > 0)
    const actions = lines.map(line => (JSON.parse(line) as { detail?: { action?: string } }).detail?.action)
    expect(actions).toContain('prompt-save.approval-requested')
    expect(actions).toContain('prompt-save.committed')
    const committed = lines.map(line => JSON.parse(line) as { detail?: Record<string, unknown> })
      .find(record => record.detail?.['action'] === 'prompt-save.committed')
    expect(committed?.detail?.['operator']).toBe('alice')
    expect(committed?.detail?.['versionId']).toBe(phase2.version?.id)
    expect(committed?.detail?.['versionSeq']).toBe(2)
  })

  it('拒绝分支:空文本 / diff 为空 / 乐观锁不符 / patch 落点缺失', async () => {
    await attach()
    const empty = await gateway.promptSave({ content: '   ' })
    expect(empty.status).toBe('rejected')
    expect(empty.issues?.[0]).toContain('不能为空')
    const same = await gateway.promptSave({ content: PERSONA_V1 })
    expect(same.status).toBe('rejected')
    expect(same.issues?.[0]).toContain('diff 为空')
    const locked = await gateway.promptSave({ content: `${PERSONA_V1} v2`, baseVersionId: 'v-bogus' })
    expect(locked.status).toBe('rejected')
    expect(locked.issues?.[0]).toContain('baseVersionId')
    const broken = new LoopPromptGateway(asStudio(new Context()), {
      patchPath: join(dir, 'no-preset-row.yml'), auditFilePath: auditPath, dryRunVerify: false,
    })
    writeFileSync(join(dir, 'no-preset-row.yml'), '- id: other\n  config: {}\n', 'utf8')
    const missing = await broken.promptSave({ content: `合法内容 ${RED_LINES}` }).catch((cause: unknown) => cause)
    expect(remoteErrorOf(missing)?.code).toBe('gateway/bad-request')
    await broken.dispose()
  })

  it('两段式回滚:产生新版本(source=rollback)而非删旧版本', async () => {
    await attach()
    const v1 = (await gateway.promptVersions({})).versions[0]
    // 先保存 v2(否则回滚目标与现值一致 → diff 空,合理拒绝)
    const v2 = `${PERSONA_V1}\nv2`
    const savePhase1 = await gateway.promptSave({ content: v2, author: 'alice' })
    await gateway.promptSave({ content: v2, author: 'alice', approvalId: savePhase1.approval?.approvalId ?? '', approved: true })
    const phase1 = await gateway.promptRollback({ versionId: v1?.id ?? '', author: 'bob' })
    expect(phase1.status).toBe('approval-required')
    const phase2 = await gateway.promptRollback({
      versionId: v1?.id ?? '', author: 'bob', approvalId: phase1.approval?.approvalId ?? '', approved: true,
    })
    expect(phase2.status).toBe('committed')
    expect(phase2.version?.source).toBe('rollback')
    expect(phase2.version?.parentId).toBe(v1?.id)
    expect(phase2.version?.content).toBe(PERSONA_V1)
    const versions = await gateway.promptVersions({})
    expect(versions.total).toBe(3) // 只增不删:v1(initial) + v2(save) + v3(rollback)
    expect(versions.versions.map(record => record.source)).toEqual(['rollback', 'save', 'initial']) // 新→旧
    expect((await new PersonaPatchFile(patchPath).read()).text).toBe(PERSONA_V1)
  })

  it('回滚目标不存在 → rejected', async () => {
    await attach()
    const result = await gateway.promptRollback({ versionId: 'v-none' })
    expect(result.status).toBe('rejected')
    expect(result.issues?.[0]).toContain('不存在')
  })

  it('导出/导入:checksum 闭环;篡改拒收;导入走同一审批链', async () => {
    await attach()
    const v2 = `${PERSONA_V1}\nv2`
    const savePhase1 = await gateway.promptSave({ content: v2, author: 'alice' })
    await gateway.promptSave({ content: v2, author: 'alice', approvalId: savePhase1.approval?.approvalId ?? '', approved: true })
    const latest = (await gateway.promptVersions({})).versions[0]
    const exported = await gateway.promptExport({ exportedBy: 'alice' })
    expect(exported.pack.schemaVersion).toBe(1)
    expect(exported.pack.persona).toBe(latest?.content)
    expect(exported.pack.checksum).toBe(sha256Hex(exported.pack.persona))
    expect(exported.pack.exportedBy).toBe('alice')
    // 篡改 persona → checksum 不符拒收
    const tampered = { ...exported.pack, persona: '篡改后的内容' }
    const rejected = await gateway.promptImport({ pack: tampered })
    expect(rejected.status).toBe('rejected')
    expect(rejected.issues?.[0]).toContain('校验和不符')
    // 正常导入(内容与现值不同;同一套内容校验——须带三条红线锚点)→ 审批 → committed(source=import)
    const importBody = `导入替换的新 persona\n${RED_LINES}`
    const imported = { ...exported.pack, persona: importBody, checksum: sha256Hex(importBody) }
    const phase1 = await gateway.promptImport({ pack: imported, author: 'carol' })
    expect(phase1.status).toBe('approval-required')
    const phase2 = await gateway.promptImport({
      pack: imported, author: 'carol', approvalId: phase1.approval?.approvalId ?? '', approved: true,
    })
    expect(phase2.status).toBe('committed')
    expect(phase2.version?.source).toBe('import')
    expect(phase2.version?.author).toBe('carol')
    // 乐观锁:baseVersionId 与最新版本不符 → 拒绝(save/rollback/import 三写端点治理一致)
    const lockedBody = `乐观锁负样本 persona\n${RED_LINES}`
    const importLocked = await gateway.promptImport({
      pack: { ...exported.pack, persona: lockedBody, checksum: sha256Hex(lockedBody) },
      baseVersionId: 'v-bogus',
    })
    expect(importLocked.status).toBe('rejected')
    expect(importLocked.issues?.[0]).toContain('baseVersionId')
    // schemaVersion 不支持(线类型钉 1;运行时负样本经 unknown 收窄校验)
    const badPack = { ...exported.pack, schemaVersion: 2 } as unknown as PromptExportPack
    const badSchema = await gateway.promptImport({ pack: badPack })
    expect(badSchema.status).toBe('rejected')
    expect(badSchema.issues?.[0]).toContain('schemaVersion')
  })

  it('审批拒绝 → approval-declined,无新版本、patch 不变', async () => {
    await attach()
    const phase1 = await gateway.promptSave({ content: `${PERSONA_V1} v2` })
    const phase2 = await gateway.promptSave({
      content: `${PERSONA_V1} v2`, approvalId: phase1.approval?.approvalId ?? '', approved: false,
    })
    expect(phase2.status).toBe('approval-declined')
    expect((await gateway.promptVersions({})).total).toBe(1)
    expect((await new PersonaPatchFile(patchPath).read()).text).toBe(PERSONA_V1)
  })

  it('T7.3:导入内容缺红线段 → 同一套校验拒收(issues 指明缺哪条)', async () => {
    await attach()
    const noRedLine = '没有红线的 persona'
    const pack = {
      schemaVersion: 1, exportedAt: new Date().toISOString(), exportedBy: 'alice',
      sourceVersionId: 'v-x', persona: noRedLine, checksum: sha256Hex(noRedLine),
    } satisfies PromptExportPack
    const result = await gateway.promptImport({ pack })
    expect(result.status).toBe('rejected')
    expect(result.issues?.join('\n')).toContain('红线段')
    expect(result.issues?.join('\n')).toContain('比选中立')
    expect((await gateway.promptVersions({})).total).toBe(1)
  })

  it('T7.3:坏包形状拒收(pack 非 JSON 对象/数组形态)', async () => {
    await attach()
    for (const bad of [null, 'str', 42, ['pack']]) {
      const result = await gateway.promptImport({ pack: bad as unknown as PromptExportPack })
      expect(result.status).toBe('rejected')
      expect(result.issues?.[0]).toContain('导入包')
    }
  })

  it('T7.3:回滚到无红线的 initial 基线 → committed(存量逐字恢复,内容校验豁免)', async () => {
    // 专设:initial 种子内容不含三条红线锚点(模拟红线规则之前装载的基线),
    // 回滚必须仍可用——否则「初始版本永久保留」的逃生门被锁死。
    const bareUnit = new MemoryUnit()
    const backend = { kv: { open: async () => bareUnit as unknown as KvUnit }, close: async () => undefined }
    const barePatchPath = join(dir, 'bare.patch.yml')
    writeFileSync(barePatchPath, fixturePatch('无红线基线'), 'utf8')
    const bareGateway = new LoopPromptGateway(asStudio(new Context()), {
      patchPath: barePatchPath, sessionsRoot, auditFilePath: auditPath, dryRunVerify: false,
    })
    await bareGateway.attachBackend(backend)
    const savePhase1 = await bareGateway.promptSave({ content: `无红线基线\n${RED_LINES}`, author: 'alice' })
    expect(savePhase1.status).toBe('approval-required')
    await bareGateway.promptSave({
      content: `无红线基线\n${RED_LINES}`, author: 'alice',
      approvalId: savePhase1.approval?.approvalId ?? '', approved: true,
    })
    const versions = await bareGateway.promptVersions({})
    expect(versions.total).toBe(2)
    const initialId = versions.versions.at(-1)?.id ?? ''
    const rollbackPhase1 = await bareGateway.promptRollback({ versionId: initialId, author: 'bob' })
    expect(rollbackPhase1.status).toBe('approval-required')
    const rollbackPhase2 = await bareGateway.promptRollback({
      versionId: initialId, author: 'bob', approvalId: rollbackPhase1.approval?.approvalId ?? '', approved: true,
    })
    expect(rollbackPhase2.status).toBe('committed')
    expect(rollbackPhase2.version?.source).toBe('rollback')
    expect(rollbackPhase2.version?.content).toBe('无红线基线')
    expect((await bareGateway.promptVersions({})).total).toBe(3) // 只增不删
    await bareGateway.dispose()
  })

  it('dispose 后:版本库关闭(再查版本即 RemoteError)', async () => {
    await attach()
    await gateway.dispose()
    const error = await gateway.promptVersions({}).catch((cause: unknown) => cause)
    expect(remoteErrorOf(error)?.code).toBe('gateway/bad-request')
  })

  it('审计走 ctx.governance 服务(在场时),兜底文件不写', async () => {
    const reported: Record<string, unknown>[] = []
    const ctx = new Context()
    ctx.provide('governance', {
      audit: { reportGovernance: (detail: Record<string, unknown>) => { reported.push(detail); return [] } },
    })
    const governed = new LoopPromptGateway(asStudio(ctx), { patchPath, auditFilePath: auditPath, dryRunVerify: false })
    const rejected = await governed.promptSave({ content: '' })
    expect(rejected.status).toBe('rejected')
    expect(reported.length).toBeGreaterThan(0)
    expect(reported[0]?.['action']).toBe('prompt-save.rejected')
    await governed.dispose()
  })
})
