/**
 * Host 半边插件测试(T7.1):
 * - 12 个 SRC 端点的 @Remote marker(手工施加路径)与端点字符串(T2.3 起
 *   含 loopPrompt/session-snapshot,T3.1 起含 ai-status/ai-polish/ai-review;
 * - default export 插件形态(name/apply/总 disposer);
 * - 全写链路在进程内打通:approval-required → confirm → committed(patch 原子写 +
 *   版本库追加 + 审计留痕),回滚/导入/乐观锁/校验拒绝/storage 未就绪分支;
 * - T2.3 快照查询端点契约:按 sessionId 返回当时 effective prompt;未知
 *   sessionId → not-found 明示不炸(深度语义/不可变性见 tests/session-snapshot.test.ts)。
 *
 * 真实 cordis Context(裸根):profileContext 缺席 → patchPath/审计/会话根全部走
 * 插件 config 覆写(与宿主 profileContext 提供时的缺省路径同构)。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import plugin, {
  DEFAULT_ENTRY_ID, ENDPOINTS, LOOP_PROMPT_SERVICE_ID, LoopPromptGateway, PROMPT_REGISTRY_ENTRIES,
  PROMPT_REGISTRY_SERVICE_ID, STORAGE_JSON_BACKEND_KEY, WILDCARD_WRITE_RULE_ID, definePromptStudioPlugin,
  entryWriteRuleId, validateEntryText,
} from '../src/index.ts'
import type {
  EntryNotFoundResult, PromptExportPack, PromptGetEntryResult, SessionSnapshotEntry,
  SessionSnapshotGetResult, SessionSnapshotNotFoundResult, StudioContextLike, VersionsResult,
} from '../src/types.ts'
import { PersonaPatchFile } from '../src/persona-patch.ts'
import { SNAPSHOTS_TABLE } from '../src/session-snapshot.ts'
import { VERSIONS_TABLE } from '../src/version-store.ts'
import { sha256Hex } from '../src/checksum.ts'
import { byteLength } from '../src/checksum.ts'

/** 基线 persona(单行;T7.3 起内含三条红线锚点,对齐 packs/event-planning persona 全局硬约束)。 */
const PERSONA_V1 = 'You are the Eterna enterprise assistant. T7-STUDIO-V1 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
/** 三条红线锚点文本(拼接新内容用)。 */
const RED_LINES = '红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'

/** 内存 KvUnit(与 version-store.test 同款最小面;T2.3 起双表:versions + snapshots)。 */
class MemoryUnit {
  readonly tables = new Map<string, Map<string, unknown>>([[VERSIONS_TABLE, new Map()], [SNAPSHOTS_TABLE, new Map()]])
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

  it('13 个端点(T3.2 起 +ai-proposal),exportName 与请求路径一一对应', () => {
    expect(markers).toHaveLength(13)
    const names = markers.map(marker => marker.exportName ?? marker.method).sort()
    expect(names).toEqual([
      'ai-polish', 'ai-proposal', 'ai-review', 'ai-status',
      'prompt-export', 'prompt-get', 'prompt-import', 'prompt-rollback', 'prompt-save', 'prompt-versions',
      'session-snapshot', 'snapshot', 'trace',
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
    expect(ENDPOINTS.sessionSnapshot).toBe('loopPrompt/session-snapshot')
    expect(ENDPOINTS.aiStatus).toBe('loopPrompt/ai-status')
    expect(ENDPOINTS.aiPolish).toBe('loopPrompt/ai-polish')
    expect(ENDPOINTS.aiReview).toBe('loopPrompt/ai-review')
    expect(ENDPOINTS.aiProposal).toBe('loopPrompt/ai-proposal')
  })

  it('json backend 服务键来自官方 storageBackendServiceKey', () => {
    expect(STORAGE_JSON_BACKEND_KEY).toBe('storage.backend.json')
  })
})

describe('default export 插件形态(DSH bundle loader 契约)', () => {
  it('name 与 apply(返回 disposer);工厂与 default 实例同构', () => {
    expect(plugin.name).toBe('eterna-prompt-studio')
    expect(typeof plugin.apply).toBe('function')
    const built = definePromptStudioPlugin()
    expect(built.name).toBe('eterna-prompt-studio')
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
    dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-host-'))
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
    // dispose 后可能仍有审计/存储异步写落盘(Linux CI 实测 ENOTEMPTY 竞态)——
    // 退避重试清理,只对 ENOTEMPTY 重试,其余错误照抛。
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt >= 4 || (error as NodeJS.ErrnoException)?.code !== 'ENOTEMPTY') throw error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
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

  it('T2.3 快照查询端点:按 sessionId 返回当时 effective prompt;未知 sessionId → not-found 明示不炸', async () => {
    await attach()
    // 会话开启 → 快照入库(等待捕获排空)。
    gateway.handleSessionCreated({ id: 'session-hp-1' })
    await gateway.drainSessionCaptures()
    const got = await gateway.sessionSnapshot({ sessionId: 'session-hp-1' }) as SessionSnapshotGetResult
    expect(got.status).toBe('ok')
    const persona = got.snapshot.entries.find(item => item.entryId === DEFAULT_ENTRY_ID) as SessionSnapshotEntry
    expect(persona.text).toBe(PERSONA_V1)
    expect(persona.versionId).toBe((await gateway.promptVersions({})).versions[0]?.id)
    expect(got.snapshot.entries).toHaveLength(PROMPT_REGISTRY_ENTRIES.length)
    const missing = await gateway.sessionSnapshot({ sessionId: 'session-unknown' }) as SessionSnapshotNotFoundResult
    expect(missing.status).toBe('not-found')
    expect(missing.issues[0]).toContain('无快照')
  })
})

/**
 * T1.4 读侧 API 按条目泛化(测试计划 §3 T1.4,①–⑤):
 * - snapshot 的 entries[]:注册表全景(每条目元数据+当前值+链概览);
 * - prompt-get/prompt-versions 按条目:块标量(| 与 >-)反引、领域包真文件、
 *   运行时注入型(text=null+note 明示)、未知 id not-found 明示;
 * - 旧调用形态(persona 缺省链)零改动兼容;链间隔离(persona 写不影响他链);
 * - 存量 v1 版本文档(无 entryId)fixture 注入:可读、归 persona 条目、不丢不重种。
 *
 * fixture patch 覆盖 preset-standard 全行(persona 裸标量/agent-instructions/
 * time-context 裸行/planning→plan-mode `section: |` 字面块)+ preset-cordis persona
 * `prefix: >-` 折叠块——与隔离档(t7-studio)live patch 同构(time-context 裸行是
 * live patch 真实形状,保留 fixture 本身;该插件 2026-11-11 用户裁定不登记,条目
 * 已从注册表移除);领域/运行时层条目经 repoRoot=真实仓库根读取(真文件钉住,
 * 手法对齐 registry.test.ts)。
 */
describe('T1.4 读侧 API 按条目泛化(snapshot entries[] / prompt-get {entryId} / prompt-versions {entryId})', () => {
  const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
  /** plan-mode 字面块(|)两段内容(段落间空行保真是断言点)。 */
  const PLAN_MODE_TEXT = 'You are in plan mode. Stay in plan mode.\n\nExplore first. Use non-mutating reads.\n'

  let dir: string
  let auditPath: string
  let gateway: LoopPromptGateway

  /** preset-standard 全行 + preset-cordis persona 折叠块的 live patch(t7 隔离档同构)。 */
  function richFixturePatch(): string {
    return [
      '# T1.4 fixture:preset-standard 全行 + preset-cordis persona 折叠块(live patch 同构)',
      '- id: preset-standard',
      "  name: '@deepseek-ai/dsh-agent-preset'",
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      `          prefix: '${PERSONA_V1}'`,
      '      - id: agent-instructions',
      "        name: '@deepseek-ai/dsh-agent-instructions'",
      '        config:',
      '          maxBytes: 65536',
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
      '                  ',
      '                  Explore first. Use non-mutating reads.',
      '',
      '- id: preset-cordis',
      "  name: '@deepseek-ai/dsh-agent-preset'",
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      '          prefix: >-',
      '            You are a coding agent powered by the {{model}} model.',
      '',
    ].join('\n')
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-t14-'))
    auditPath = join(dir, 'audit.jsonl')
    writeFileSync(join(dir, 'cordis.patch.yml'), richFixturePatch(), 'utf8')
    const ctx = new Context()
    gateway = new LoopPromptGateway(asStudio(ctx), {
      patchPath: join(dir, 'cordis.patch.yml'),
      auditFilePath: auditPath,
      dryRunVerify: false,
      repoRoot: REPO_ROOT,
    })
  })

  afterEach(async () => {
    await gateway.dispose()
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt >= 4 || (error as NodeJS.ErrnoException)?.code !== 'ENOTEMPTY') throw error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  })

  function attach(unit: MemoryUnit = new MemoryUnit()): Promise<MemoryUnit> {
    const backend = { kv: { open: async () => unit as unknown as KvUnit }, close: async () => undefined }
    return gateway.attachBackend(backend).then(() => unit)
  }

  it('①+② snapshot.entries[]:14 条全景(T3.1 起含元提示词层×2;2026-11-11 裁定后无 time-context),逐条目当前值与链概览(块标量/裸标量/领域/运行时分型语义)', async () => {
    await attach()
    const snapshot = await gateway.snapshot()
    expect(snapshot.entries).toHaveLength(PROMPT_REGISTRY_ENTRIES.length)
    expect(new Set(snapshot.entries.map(item => item.id))).toEqual(new Set(PROMPT_REGISTRY_ENTRIES.map(entry => entry.id)))
    const byId = new Map(snapshot.entries.map(item => [item.id, item]))
    // 裸标量 persona:当前值=live patch 现值,链已种子(ensureInitial 语义)。
    const persona = byId.get('preset.standard.persona')
    expect(persona?.value.text).toBe(PERSONA_V1)
    expect(persona?.versions.ready).toBe(true)
    expect(persona?.versions.count).toBe(1)
    expect(persona?.versioned).toBe(true)
    // 折叠块标量(>-):preset-cordis persona 折叠反引为单行。
    const cordisPersona = byId.get('preset.cordis.persona')
    expect(cordisPersona?.value.text).toBe('You are a coding agent powered by the {{model}} model.')
    expect(cordisPersona?.versions.count).toBe(1)
    // 字面块标量(|):plan-mode section 整段反引(段落间空行+clip 尾换行)。
    const planMode = byId.get('preset.standard.plan-mode.section')
    expect(planMode?.value.text).toBe(PLAN_MODE_TEXT)
    expect(planMode?.versions.count).toBe(1)
    // 数值配置条目:反引值与 MAX 交叉钉住。
    expect(byId.get('preset.standard.agent-instructions')?.value.text).toBe('65536')
    // 领域层:真 pack 文件反引(>- 多行折叠为空格连接)。
    const domain = byId.get('domain.event-planning.persona-prefix')
    expect(domain?.value.text).toContain('You are a senior event planning specialist: creative, execution-strong, budget-aware')
    expect(domain?.value.text).toContain('stay neutral in vendor selection.')
    expect(domain?.versions.count).toBe(1)
    // 运行时注入型:text=null+note 明示。
    const runtime = byId.get('runtime.memory.index-section')
    expect(runtime?.value.text).toBeNull()
    expect(runtime?.versioned).toBe(false)
  })

  it('② prompt-get {entryId}:块标量条目(>- 与 |)当前值反引正确;旧 persona 值与新视图一致', async () => {
    await attach()
    const cordis = await gateway.promptGet({ entryId: 'preset.cordis.persona' }) as PromptGetEntryResult
    expect(cordis.entry.id).toBe('preset.cordis.persona')
    expect(cordis.entry.kind).toBe('patch-value')
    expect(cordis.entry.layer).toBe('preset')
    expect(cordis.entry.source).toBe('@deepseek-ai/dsh-persona')
    expect(cordis.entry.redLine).toBe('required')
    expect(cordis.entry.redLineRuleSet).toBe('eterna.red-lines.standard')
    expect(cordis.entry.versioned).toBe(true)
    expect(cordis.value.text).toBe('You are a coding agent powered by the {{model}} model.')
    expect(cordis.value.bytes).toBe(Buffer.byteLength(cordis.value.text ?? '', 'utf8'))
    expect(cordis.versions.count).toBe(1)
    const planMode = await gateway.promptGet({ entryId: 'preset.standard.plan-mode.section' }) as PromptGetEntryResult
    expect(planMode.value.text).toBe(PLAN_MODE_TEXT)
    expect(planMode.entry.redLine).toBe('exempt') // 非 persona 条目红线豁免(T1.3 标记生效)
    expect(planMode.entry.redLineRuleSet).toBeUndefined()
    // persona 条目:per-entry 视图与旧形态(patcher 读数)同值。
    const personaEntry = await gateway.promptGet({ entryId: DEFAULT_ENTRY_ID }) as PromptGetEntryResult
    expect(personaEntry.value.text).toBe(PERSONA_V1)
    const legacy = await gateway.promptGet()
    expect(legacy.persona.text).toBe(personaEntry.value.text)
  })

  it('② 运行时注入型:text=null + note 明示,不伪造静态值', async () => {
    await attach()
    const runtime = await gateway.promptGet({ entryId: 'runtime.glue.memory-plugin' }) as PromptGetEntryResult
    expect(runtime.entry.kind).toBe('runtime-injection')
    expect(runtime.value.text).toBeNull()
  })

  it('② 未知 entryId:prompt-get/prompt-versions 返回 status=not-found 明示,不抛裸异常', async () => {
    await attach()
    const got = await gateway.promptGet({ entryId: 'no.such.entry' })
    expect((got as EntryNotFoundResult).status).toBe('not-found')
    expect((got as EntryNotFoundResult).entryId).toBe('no.such.entry')
    expect((got as EntryNotFoundResult).issues[0]).toContain('未知条目 id')
    const versions = await gateway.promptVersions({ entryId: 'also.missing' })
    expect((versions as EntryNotFoundResult).status).toBe('not-found')
    expect((versions as EntryNotFoundResult).issues[0]).toContain('未知条目 id')
  })

  it('③ 旧调用形态兼容:无参/空参 prompt-get、无 entryId prompt-versions = persona 缺省链', async () => {
    await attach()
    const noArg = await gateway.promptGet()
    expect(noArg.persona.text).toBe(PERSONA_V1)
    expect(noArg.composedNote).toContain('T7.2')
    const emptyArg = await gateway.promptGet({})
    expect(emptyArg.persona.text).toBe(PERSONA_V1)
    // 无 entryId 的版本列表 = 默认条目(persona)链——他链种子不混入旧口径。
    const legacy = await gateway.promptVersions({})
    expect(legacy.total).toBe(1)
    expect(legacy.entryId).toBeUndefined()
    expect(legacy.versions[0]?.entryId).toBe(DEFAULT_ENTRY_ID)
    expect(legacy.versions[0]?.source).toBe('initial')
    const explicit = await gateway.promptVersions({ entryId: DEFAULT_ENTRY_ID }) as VersionsResult
    expect(explicit.entryId).toBe(DEFAULT_ENTRY_ID)
    expect(explicit.total).toBe(legacy.total)
  })

  it('①+③ 每条目版本链隔离:persona 保存只动 persona 链(seq 链内连续),他链不受影响', async () => {
    await attach()
    const next = `${PERSONA_V1}\n新增红线行`
    const phase1 = await gateway.promptSave({ content: next, author: 'alice' })
    await gateway.promptSave({ content: next, author: 'alice', approvalId: phase1.approval?.approvalId ?? '', approved: true })
    // persona 链:initial(seq1) → save(seq2),链内新→旧。
    const personaChain = await gateway.promptVersions({ entryId: DEFAULT_ENTRY_ID }) as VersionsResult
    expect(personaChain.total).toBe(2)
    expect(personaChain.versions.map(record => record.seq)).toEqual([2, 1])
    expect(personaChain.versions.map(record => record.source)).toEqual(['save', 'initial'])
    // 他链不受 persona 写影响(种子仍是链首)。
    const planModeChain = await gateway.promptVersions({ entryId: 'preset.standard.plan-mode.section' }) as VersionsResult
    expect(planModeChain.total).toBe(1)
    expect(planModeChain.versions[0]?.source).toBe('initial')
    expect(planModeChain.versions[0]?.content).toBe(PLAN_MODE_TEXT)
    // 旧口径 total 同样只数 persona 链。
    expect((await gateway.promptVersions({})).total).toBe(2)
  })

  it('② live patch 缺行条目:结构定位失败明示(problems),不种子假基线', async () => {
    // 最小 patch 只有 preset-standard persona 行:preset-cordis.persona 定位失败 →
    // text=null+problems 明示、链空(count=0),snapshot entries[] 仍全景在场。
    const minimalPath = join(dir, 'minimal.patch.yml')
    writeFileSync(minimalPath, fixturePatch(), 'utf8')
    const ctx = new Context()
    const minimal = new LoopPromptGateway(asStudio(ctx), {
      patchPath: minimalPath, auditFilePath: auditPath, dryRunVerify: false, repoRoot: REPO_ROOT,
    })
    const backend = { kv: { open: async () => new MemoryUnit() as unknown as KvUnit }, close: async () => undefined }
    await minimal.attachBackend(backend)
    const got = await minimal.promptGet({ entryId: 'preset.cordis.persona' }) as PromptGetEntryResult
    expect(got.value.text).toBeNull()
    expect(got.value.problems.join('\n')).toContain('结构定位失败')
    expect(got.versions.count).toBe(0)
    const snapshot = await minimal.snapshot()
    expect(snapshot.entries).toHaveLength(PROMPT_REGISTRY_ENTRIES.length)
    // 领域层真文件仍可读(仓库根解析,不随 live patch 缺行降级)。
    expect(snapshot.entries.find(item => item.id === 'domain.industrial-analysis.persona-prefix')?.value.text)
      .toContain('You are a senior industrial data-intelligence analysis specialist')
    await minimal.dispose()
  })

  it('⑤ 存量 v1 版本文档(无 entryId)注入:可读、默认归 persona 条目、不丢不重种', async () => {    // fixture=2026-11-10 t7-smoke 真实产出的三份磁盘文档原样誊录({version,record} 包络,
    // 记录无 entryId 字段)。注入 MemoryUnit(即真实 backend loadAll 的解包结果)。
    const docs = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'legacy-v1-version-records.json'), 'utf8')) as Array<{ record: Record<string, unknown> }>
    expect(docs).toHaveLength(3)
    const unit = new MemoryUnit()
    for (const doc of docs) {
      unit.tables.get(VERSIONS_TABLE)?.set(doc.record['id'] as string, doc.record)
    }
    await attach(unit)
    // 旧口径(缺省链=persona):三条全在,新→旧 rollback/save/initial——不读失败、不丢。
    const legacy = await gateway.promptVersions({})
    expect(legacy.total).toBe(3)
    expect(legacy.versions.map(record => record.source)).toEqual(['rollback', 'save', 'initial'])
    // 显式按默认条目查询:同一批记录(默认归 persona 条目),entryId 回填。
    const personaChain = await gateway.promptVersions({ entryId: DEFAULT_ENTRY_ID }) as VersionsResult
    expect(personaChain.total).toBe(3)
    expect(personaChain.versions.every(record => record.entryId === DEFAULT_ENTRY_ID)).toBe(true)
    // 摘要原文保留(未被静默改写/迁移重写)。
    expect(personaChain.versions.at(-1)?.summary).toBe('装载时种子的 persona 基线(profile patch 层现值)')
    // attach 不对 persona 重种(initial 仍是链首且唯一);领域条目照常各自种子。
    expect(personaChain.versions.at(-1)?.source).toBe('initial')
    const domainChain = await gateway.promptVersions({ entryId: 'domain.event-planning.persona-md' }) as VersionsResult
    expect(domainChain.total).toBe(1)
    // 存量链可继续写:persona 保存 → 链 total=4、新版本 parentId 指向存量链首。
    const next = `${PERSONA_V1}\n续写红线 ${RED_LINES}`
    const phase1 = await gateway.promptSave({ content: next, author: 'alice' })
    const phase2 = await gateway.promptSave({ content: next, author: 'alice', approvalId: phase1.approval?.approvalId ?? '', approved: true })
    expect(phase2.status).toBe('committed')
    const after = await gateway.promptVersions({})
    expect(after.total).toBe(4)
    expect(phase2.version?.parentId).toBe(after.versions[1]?.id)
    expect((await gateway.promptVersions({ entryId: 'domain.event-planning.persona-md' }) as VersionsResult).total).toBe(1)
  })

  it('T1.6 按条目回滚(原 T1.4 过渡守卫的泛化收编):plan-mode 块标量条目回滚写回自身落点,persona 落点零污染', async () => {
    await attach()
    const patchFile = join(dir, 'cordis.patch.yml')
    const planChainBefore = await gateway.promptVersions({ entryId: 'preset.standard.plan-mode.section' }) as VersionsResult
    const initialId = planChainBefore.versions?.[0]?.id ?? ''
    expect(initialId).not.toBe('')
    // 先保存 plan-mode 新文(形态 C | 字面块;内容过按条目校验:exempt 红线 + 字节上限)。
    const planV2 = `${PLAN_MODE_TEXT}T1.6-GUARD append line.\n`
    const savePhase1 = await gateway.promptSave({ entryId: 'preset.standard.plan-mode.section', content: planV2, author: 'alice' })
    expect(savePhase1.status).toBe('approval-required')
    const savePhase2 = await gateway.promptSave({
      entryId: 'preset.standard.plan-mode.section', content: planV2, author: 'alice',
      approvalId: savePhase1.approval?.approvalId ?? '', approved: true,
    })
    expect(savePhase2.status).toBe('committed')
    expect(savePhase2.version?.entryId).toBe('preset.standard.plan-mode.section')
    // 写回落在 plan-mode 块(prompt-get 反引==新文),persona 前缀行未动。
    const afterSave = await gateway.promptGet({ entryId: 'preset.standard.plan-mode.section' }) as PromptGetEntryResult
    expect(afterSave.value.text).toBe(planV2)
    expect((await new PersonaPatchFile(patchFile).read()).text).toBe(PERSONA_V1)
    // 回滚两段式 → 新版本(source=rollback,parentId=被回滚版本),patch 层反引恢复旧文。
    const rbPhase1 = await gateway.promptRollback({ versionId: initialId, author: 'bob' })
    expect(rbPhase1.status).toBe('approval-required')
    const rbPhase2 = await gateway.promptRollback({
      versionId: initialId, author: 'bob', approvalId: rbPhase1.approval?.approvalId ?? '', approved: true,
    })
    expect(rbPhase2.status).toBe('committed')
    expect(rbPhase2.version?.source).toBe('rollback')
    expect(rbPhase2.version?.parentId).toBe(initialId)
    expect(rbPhase2.version?.entryId).toBe('preset.standard.plan-mode.section')
    const afterRollback = await gateway.promptGet({ entryId: 'preset.standard.plan-mode.section' }) as PromptGetEntryResult
    expect(afterRollback.value.text).toBe(PLAN_MODE_TEXT)
    // 版本只增不删:plan-mode 链 3(initial+save+rollback);persona 链仍 1;无在途审批。
    const planChainAfter = await gateway.promptVersions({ entryId: 'preset.standard.plan-mode.section' }) as VersionsResult
    expect(planChainAfter.total).toBe(3)
    expect((await gateway.promptVersions({})).total).toBe(1)
    expect((await new PersonaPatchFile(patchFile).read()).text).toBe(PERSONA_V1)
    expect((await gateway.snapshot()).pendingApproval).toBeNull()
    // entryId 与版本归属不符 → fail-closed 拒回滚(泛化后的错配守卫)。
    const mismatch = await gateway.promptRollback({ versionId: initialId, entryId: DEFAULT_ENTRY_ID, author: 'mallory' })
    expect(mismatch.status).toBe('rejected')
    expect(mismatch.issues?.[0]).toContain('属于条目 preset.standard.plan-mode.section')
  })

  it('守卫(评审 2026-11-11→T1.6 泛化):跨条目导出需 entryId 指名;错配仍 fail-closed', async () => {
    await attach()
    const domainChain = await gateway.promptVersions({ entryId: 'domain.event-planning.persona-prefix' }) as VersionsResult
    // 不带 entryId 的跨条目导出(persona 口径)仍 fail-closed。
    const error = await gateway.promptExport({ versionId: domainChain.versions[0]?.id ?? '' }).catch((cause: unknown) => cause)
    expect(remoteErrorOf(error)?.code).toBe('gateway/bad-request')
    expect(String(remoteErrorOf(error)?.message)).toContain('domain.event-planning.persona-prefix')
    // T1.6:显式 entryId 的按条目导出放行,包带 entryId 字段。
    const pack = await gateway.promptExport({ entryId: 'domain.event-planning.persona-prefix', versionId: domainChain.versions[0]?.id ?? '' })
    expect(pack.pack.entryId).toBe('domain.event-planning.persona-prefix')
    expect(pack.pack.persona).toBe(domainChain.versions[0]?.content)
    expect(pack.pack.checksum).toBe(sha256Hex(pack.pack.persona))
    // 默认条目导出不受影响,包形状零差异(无 entryId 字段)。
    const normal = await gateway.promptExport({})
    expect(normal.pack.persona).toBe(PERSONA_V1)
    expect('entryId' in normal.pack).toBe(false)
  })

  it('分型生效说明(评审 2026-11-11):运行时注入型不透传「保存生效」语义', async () => {
    await attach()
    const runtime = await gateway.promptGet({ entryId: 'runtime.memory.index-section' }) as PromptGetEntryResult
    expect(runtime.effectiveNote).not.toContain('保存对新会话生效')
    expect(runtime.effectiveNote).toContain('只读')
    // 可写条目(patch 值型)维持既有生效说明。
    const writable = await gateway.promptGet({ entryId: 'preset.standard.plan-mode.section' }) as PromptGetEntryResult
    expect(writable.effectiveNote).toContain('保存对新会话生效')
  })

  it('缺席降级(评审 2026-11-11):storage 未挂载时 per-entry 读侧不炸,entries[] 全 ready=false/count=0', async () => {
    // 不 attach:store 未就绪。
    const snapshot = await gateway.snapshot()
    expect(snapshot.versions.ready).toBe(false)
    expect(snapshot.entries).toHaveLength(PROMPT_REGISTRY_ENTRIES.length)
    for (const item of snapshot.entries) {
      expect(item.versions.ready, item.id).toBe(false)
      expect(item.versions.count, item.id).toBe(0)
      expect(item.versions.latestId, item.id).toBeNull()
    }
    // per-entry prompt-get:当前值仍可读(文件面不依赖 storage),链概览降级 ready=false,不抛。
    const domain = await gateway.promptGet({ entryId: 'domain.event-planning.persona-prefix' }) as PromptGetEntryResult
    expect(domain.value.text).toContain('You are a senior event planning specialist')
    expect(domain.versions.ready).toBe(false)
    expect(domain.versions.count).toBe(0)
    // per-entry prompt-versions:与旧口径一致,RemoteError(bad-request)明示未就绪。
    const error = await gateway.promptVersions({ entryId: 'domain.event-planning.persona-prefix' }).catch((cause: unknown) => cause)
    expect(remoteErrorOf(error)?.code).toBe('gateway/bad-request')
  })
})

/**
 * T1.6 写链路按条目泛化(测试计划 §3 T1.6(b) ①–⑥ + §6 横切 1/2/3/6):
 * - ① R3 按条目授权:受限规则集未覆盖条目一段直接 rejected;② 通配规则覆盖新条目;
 * - ③ 字节上限逐条目(65536 过/65537 拒,按注册表条目参数化);
 * - ④ 红线锚点逐条目:persona 类缺红线拒收且 issues 指明;非 persona 豁免;
 *   工业规则集(达梦只读/只经 MCP/R2/deny-first)与标准集双语锚点;
 * - ⑤ 回滚逐条目:块标量形态 A/B/C 各 ≥1 例(回滚后 patch 层反引==被回滚文本),
 *   运行时注入型条目回滚 fail-closed 明示;
 * - ⑥ 导入通道逐条目:超限/缺红线/stale 锁拒收未入库 + 审计 prompt-import.rejected;
 *   块标量形态 A/B/C 导入后 patch 反引一致;
 * - TOCTOU:审批后文件被外部改写 → 二段拒写零落盘、外部状态保持;
 * - 审计事件带 entryId 字段;审批卡 ruleId 按条目解析。
 *
 * 领域层条目写入 fixture 仓库根(repoRoot 临时目录,pack 文件同构真仓形态),
 * 绝不写真仓文件;preset 层写入 live patch(patchPath 临时目录)。
 */
describe('T1.6 写链路按条目泛化(R3 按条目授权 + 校验器逐条目 + 回滚/导入同门禁)', () => {
  /** 标准三条红线的英文转述(event-planning personaPrefix 同款,验证双语锚点)。 */
  const RED_LINES_EN = 'Never silently exceed budgets, never make or promise external payments, stay neutral in vendor selection.'
  /** 工业四条红线英文句(industrial-analysis personaPrefix 同款)。 */
  const RED_LINES_INDUSTRIAL = 'The DM business database is read-only; data and knowledge layers are accessed only via MCP; every external send requires confirmation (R2). Deny-first, fail-closed.'
  const EVENT_PREFIX_V1 = 'You are a senior event planning specialist: creative, execution-strong. ' + RED_LINES_EN
  const INDUSTRIAL_PREFIX_V1 = 'You are a senior industrial data-intelligence analysis specialist. ' + RED_LINES_INDUSTRIAL

  let dir: string
  let repoRoot: string
  let patchPath: string
  let auditPath: string
  let gateway: LoopPromptGateway

  /** live patch:两预设 persona(裸标量 + >- 折叠块)+ planning→plan-mode `|` 字面块。 */
  function t16FixturePatch(): string {
    return [
      '# T1.6 fixture:preset-standard(裸标量+plan-mode |)+ preset-cordis(>- 折叠块)',
      '- id: preset-standard',
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      `          prefix: '${PERSONA_V1}'`,
      '      - id: planning',
      '        name: cordis:group',
      '        group: true',
      '        config:',
      '          - id: plan-mode',
      "            name: '@deepseek-ai/dsh-plan-mode'",
      '            config:',
      '              section: |',
      '                You are in plan mode. Stay in plan mode.',
      '                ',
      '                Explore first. Use non-mutating reads.',
      '- id: preset-cordis',
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      '          prefix: >-',
      '            You are a coding agent powered by the {{model}} model.',
      '',
    ].join('\n')
  }

  /** fixture 仓库根:两 pack 的 patch(形态 A >- 块)与 persona.md(整文件条目)。 */
  function seedFixtureRepo(): void {
    mkdirSync(join(repoRoot, 'packs/event-planning'), { recursive: true })
    mkdirSync(join(repoRoot, 'packs/industrial-analysis'), { recursive: true })
    writeFileSync(join(repoRoot, 'packs/event-planning/cordis.patch.yml'), [
      '# fixture event pack patch',
      '- id: system-prompt',
      '  config:',
      '    personaPrefix: >-',
      ...EVENT_PREFIX_V1.split(' ').reduce<string[][]>((rows, word, i) => {
        if (i % 8 === 0) rows.push([])
        rows[rows.length - 1]?.push(word)
        return rows
      }, []).map(row => `      ${row.join(' ')}`),
      '',
    ].join('\n'), 'utf8')
    writeFileSync(join(repoRoot, 'packs/event-planning/persona.md'), `# persona\n\n${EVENT_PREFIX_V1}\n`, 'utf8')
    writeFileSync(join(repoRoot, 'packs/industrial-analysis/cordis.patch.yml'), [
      '# fixture industrial pack patch',
      '- id: system-prompt',
      '  config:',
      '    personaPrefix: >-',
      ...INDUSTRIAL_PREFIX_V1.split(' ').reduce<string[][]>((rows, word, i) => {
        if (i % 8 === 0) rows.push([])
        rows[rows.length - 1]?.push(word)
        return rows
      }, []).map(row => `      ${row.join(' ')}`),
      '',
    ].join('\n'), 'utf8')
    writeFileSync(join(repoRoot, 'packs/industrial-analysis/persona.md'), `# persona\n\n${INDUSTRIAL_PREFIX_V1}\n`, 'utf8')
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-t16-'))
    repoRoot = join(dir, 'repo')
    patchPath = join(dir, 'cordis.patch.yml')
    auditPath = join(dir, 'audit.jsonl')
    seedFixtureRepo()
    writeFileSync(patchPath, t16FixturePatch(), 'utf8')
    const ctx = new Context()
    gateway = new LoopPromptGateway(asStudio(ctx), {
      patchPath, auditFilePath: auditPath, dryRunVerify: false, repoRoot,
    })
  })

  afterEach(async () => {
    await gateway.dispose()
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt >= 4 || (error as NodeJS.ErrnoException)?.code !== 'ENOTEMPTY') throw error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  })

  function attach(unit: MemoryUnit = new MemoryUnit()): Promise<MemoryUnit> {
    const backend = { kv: { open: async () => unit as unknown as KvUnit }, close: async () => undefined }
    return gateway.attachBackend(backend).then(() => unit)
  }

  /** 两段式保存并断言 committed(便捷封装;不命中 committed 即抛)。 */
  async function saveTwoPhase(entryId: string, content: string, author = 'alice') {
    const phase1 = await gateway.promptSave({ entryId, content, author })
    expect(phase1.status, `save(${entryId}) 一段应为 approval-required:${JSON.stringify(phase1.issues ?? phase1.approval?.approvalId)}`).toBe('approval-required')
    const phase2 = await gateway.promptSave({ entryId, content, author, approvalId: phase1.approval?.approvalId ?? '', approved: true })
    expect(phase2.status, `save(${entryId}) 二段应为 committed:${JSON.stringify(phase2.issues)}`).toBe('committed')
    return { phase1, phase2 }
  }

  /** 两段式回滚并断言 committed。 */
  async function rollbackTwoPhase(versionId: string, author = 'bob') {
    const phase1 = await gateway.promptRollback({ versionId, author })
    expect(phase1.status, `rollback 一段应为 approval-required:${JSON.stringify(phase1.issues)}`).toBe('approval-required')
    const phase2 = await gateway.promptRollback({ versionId, author, approvalId: phase1.approval?.approvalId ?? '', approved: true })
    expect(phase2.status, `rollback 二段应为 committed:${JSON.stringify(phase2.issues)}`).toBe('committed')
    return { phase1, phase2 }
  }

  /** 当前值(prompt-get 反引;断言非空)。 */
  async function currentText(entryId: string): Promise<string> {
    const got = await gateway.promptGet({ entryId }) as PromptGetEntryResult
    expect(got.value.text, `${entryId} 当前值应可读`).not.toBeNull()
    return got.value.text ?? ''
  }

  /** 审计文件里的 detail 行(解析 NDJSON)。 */
  function auditDetails(): Array<Record<string, unknown>> {
    if (!existsSyncSafe(auditPath)) return []
    return readFileSync(auditPath, 'utf8').split('\n').filter(line => line.trim().length > 0)
      .map(line => (JSON.parse(line) as { detail?: Record<string, unknown> }).detail ?? {})
  }

  function existsSyncSafe(path: string): boolean {
    try {
      readFileSync(path, 'utf8')
      return true
    } catch {
      return false
    }
  }

  /** 等待审计记录落地(FileAuditSink 异步 append;轮询至谓词命中或超时)。 */
  async function waitForAudit(
    predicate: (details: Array<Record<string, unknown>>) => boolean,
    timeoutMs = 2000,
  ): Promise<Array<Record<string, unknown>>> {
    for (let waited = 0; waited < timeoutMs; waited += 10) {
      const details = auditDetails()
      if (predicate(details)) return details
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return auditDetails()
  }

  // ---------- ①② R3 按条目授权 ----------

  it('① 受限规则集(模拟非 admin):未覆盖条目一段直接 rejected;审批卡 ruleId 按条目解析', async () => {
    await attach()
    const ctx = new Context()
    const restricted = new LoopPromptGateway(asStudio(ctx), {
      patchPath, auditFilePath: auditPath, dryRunVerify: false, repoRoot,
      writeRules: ['eterna.prompt-studio.persona-write'], // 只授权默认 persona 条目
    })
    const backend = { kv: { open: async () => new MemoryUnit() as unknown as KvUnit }, close: async () => undefined }
    await restricted.attachBackend(backend)
    // 未覆盖条目(plan-mode):一段直接 rejected,不进审批。
    const denied = await restricted.promptSave({ entryId: 'preset.standard.plan-mode.section', content: 'x' })
    expect(denied.status).toBe('rejected')
    expect(denied.issues?.[0]).toContain('写授权未覆盖条目 preset.standard.plan-mode.section')
    expect(denied.issues?.[0]).toContain(entryWriteRuleId('preset.standard.plan-mode.section'))
    expect((await restricted.snapshot()).pendingApproval).toBeNull()
    // 覆盖条目(默认 persona)不受影响,且审批卡 ruleId=persona-write(T7 兼容)。
    const allowed = await restricted.promptSave({ content: `${PERSONA_V1} v2` })
    expect(allowed.status).toBe('approval-required')
    expect(allowed.approval?.card.matchedRule.ruleId).toBe('eterna.prompt-studio.persona-write')
    await restricted.dispose()
  })

  it('② 通配规则覆盖新条目:默认授权面下任意条目可写,审批卡 ruleId=entry-write.<entryId>', async () => {
    await attach()
    expect(gateway.writeRules).toEqual([WILDCARD_WRITE_RULE_ID])
    const phase1 = await gateway.promptSave({ entryId: 'preset.cordis.persona', content: `Cordis v2. ${RED_LINES}` })
    expect(phase1.status).toBe('approval-required')
    expect(phase1.approval?.card.matchedRule.ruleId).toBe('eterna.prompt-studio.entry-write.preset.cordis.persona')
    expect(phase1.approval?.card.matchedRule.grade).toBe('R3')
    expect(phase1.approval?.questionItems).toHaveLength(2)
    expect(phase1.approval?.card.why.entry).toContain('R3 · eterna.prompt-studio.entry-write.preset.cordis.persona')
  })

  // ---------- ③ 字节上限逐条目 ----------

  it('③ 字节上限按注册表条目参数化:恰限通过、+1 字节拒收(UTF-8 字节口径,CJK 按字节计)', () => {
    const patchValueEntries = PROMPT_REGISTRY_ENTRIES.filter(entry => entry.kind === 'patch-value')
    expect(patchValueEntries.length).toBeGreaterThan(0)
    for (const entry of patchValueEntries) {
      const anchors = entry.redLineRuleSet === 'eterna.red-lines.industrial-analysis'
        ? RED_LINES_INDUSTRIAL
        : entry.redLineRuleSet === 'eterna.red-lines.standard' ? RED_LINES : ''
      const atLimit = anchors + 'a'.repeat(entry.maxBytes - byteLength(anchors))
      expect(byteLength(atLimit), entry.id).toBe(entry.maxBytes)
      expect(validateEntryText(entry, atLimit).ok, `${entry.id}:恰限应通过`).toBe(true)
      const over = `${atLimit}a`
      const result = validateEntryText(entry, over)
      expect(result.ok, `${entry.id}:+1 字节应拒收`).toBe(false)
      expect(result.issues.join('\n'), entry.id).toContain(`${entry.maxBytes + 1} 字节 > ${entry.maxBytes}`)
    }
    // CJK 按字节计:红线锚点 + 65500 个三字节汉字 → 超限唯一 issue 是字节。
    const cjkAnchors = RED_LINES
    const cjkOver = cjkAnchors + '你'.repeat(Math.ceil((65536 + 1 - byteLength(cjkAnchors)) / 3))
    const cjkResult = validateEntryText({ redLine: 'required', redLineRuleSet: 'eterna.red-lines.standard' }, cjkOver)
    expect(cjkResult.ok).toBe(false)
    expect(cjkResult.issues.some(issue => issue.includes('字节 > 65536'))).toBe(true)
  })

  it('③ 网关层:超限内容在一段即拒收(issues 明示上限),版本零增长', async () => {
    await attach()
    const before = await gateway.promptVersions({ entryId: 'preset.standard.plan-mode.section' }) as VersionsResult
    const oversized = 'a'.repeat(65537)
    const result = await gateway.promptSave({ entryId: 'preset.standard.plan-mode.section', content: oversized })
    expect(result.status).toBe('rejected')
    expect(result.issues?.join('\n')).toContain('65537 字节 > 65536')
    const after = await gateway.promptVersions({ entryId: 'preset.standard.plan-mode.section' }) as VersionsResult
    expect(after.total).toBe(before.total)
  })

  // ---------- ④ 红线锚点逐条目 ----------

  it('④ persona 类条目缺红线拒收且 issues 指明缺哪条;非 persona 条目豁免(T1.3 标记生效)', async () => {
    await attach()
    // 标准集(默认 persona):缺三条 → 三条 issue 按序指明。
    const noRedLine = '干净的文本,没有红线。'
    const std = await gateway.promptSave({ content: noRedLine })
    expect(std.status).toBe('rejected')
    expect(std.issues?.join('\n')).toContain('「预算不超支」')
    expect(std.issues?.join('\n')).toContain('「不代付」')
    expect(std.issues?.join('\n')).toContain('「比选中立」')
    // 英文转述同样过标准集(双语锚点):event prefix 追加句。
    const en = await gateway.promptSave({ entryId: 'domain.event-planning.persona-prefix', content: `${EVENT_PREFIX_V1} Appended.` })
    expect(en.status).toBe('approval-required')
    await gateway.promptSave({ entryId: 'domain.event-planning.persona', content: `${PERSONA_V1} dup`, approvalId: 'ap-none', approved: true }).catch(() => undefined)
    // 非 persona 条目(plan-mode,exempt):无红线文本可保存。
    const exempt = await gateway.promptSave({ entryId: 'preset.standard.plan-mode.section', content: 'No red lines needed here.\n' })
    expect(exempt.status).toBe('approval-required')
  })

  it('④ 工业规则集逐条目:缺达梦只读锚点拒收且指明;四锚点齐备通过', async () => {
    await attach()
    const missingDm = INDUSTRIAL_PREFIX_V1.replace('The DM business database is read-only;', '').replace('达梦业务库只读', '')
    const denied = await gateway.promptSave({ entryId: 'domain.industrial-analysis.persona-prefix', content: missingDm })
    expect(denied.status).toBe('rejected')
    expect(denied.issues?.join('\n')).toContain('「达梦业务库只读」')
    expect(denied.issues?.join('\n')).not.toContain('「deny 优先 fail-closed」')
    const ok = await gateway.promptSave({ entryId: 'domain.industrial-analysis.persona-prefix', content: `${INDUSTRIAL_PREFIX_V1} Appended.` })
    expect(ok.status).toBe('approval-required')
  })

  // ---------- ⑤ 回滚逐条目(形态 A/B/C 各 ≥1 例) ----------

  it('⑤ 回滚形态 A(领域 >- 块):回滚后 patch 层反引==被回滚文本,版本链只增不删', async () => {
    await attach()
    const entryId = 'domain.event-planning.persona-prefix'
    const original = await currentText(entryId)
    const { phase2 } = await saveTwoPhase(entryId, `${EVENT_PREFIX_V1} T1.6-A v2.`)
    expect(phase2.version?.entryId).toBe(entryId)
    expect(await currentText(entryId)).toBe(`${EVENT_PREFIX_V1} T1.6-A v2.`)
    const chain = await gateway.promptVersions({ entryId }) as VersionsResult
    const initial = chain.versions.at(-1)
    const rb = await rollbackTwoPhase(initial?.id ?? '')
    expect(rb.phase2.version?.source).toBe('rollback')
    expect(rb.phase2.version?.parentId).toBe(initial?.id)
    // 块标量条目回滚后 patch 层反引==被回滚文本(形态 A 专项判据)。
    expect(await currentText(entryId)).toBe(original)
    const after = await gateway.promptVersions({ entryId }) as VersionsResult
    expect(after.total).toBe(3)
    expect(after.versions.map(record => record.source)).toEqual(['rollback', 'save', 'initial'])
  })

  it('⑤ 回滚形态 B(preset-cordis >- 块)与形态 C(plan-mode | 多段块):同门', async () => {
    await attach()
    // 形态 B。
    const cordisId = 'preset.cordis.persona'
    const cordisOriginal = await currentText(cordisId)
    await saveTwoPhase(cordisId, `Cordis v2. ${RED_LINES}`)
    let chain = await gateway.promptVersions({ entryId: cordisId }) as VersionsResult
    await rollbackTwoPhase(chain.versions.at(-1)?.id ?? '')
    expect(await currentText(cordisId)).toBe(cordisOriginal)
    // 形态 C。
    const planId = 'preset.standard.plan-mode.section'
    const planOriginal = await currentText(planId)
    await saveTwoPhase(planId, `${planOriginal}T1.6-C appended.\n`)
    chain = await gateway.promptVersions({ entryId: planId }) as VersionsResult
    const rb = await rollbackTwoPhase(chain.versions.at(-1)?.id ?? '')
    expect(rb.phase2.version?.source).toBe('rollback')
    expect(await currentText(planId)).toBe(planOriginal)
    // 两条目链各自只增不删(3+3),persona 缺省链不受影响。
    expect((await gateway.promptVersions({ entryId: cordisId }) as VersionsResult).total).toBe(3)
    expect((await gateway.promptVersions({ entryId: planId }) as VersionsResult).total).toBe(3)
  })

  it('⑤ 运行时注入型条目回滚 fail-closed 明示不支持(无写回落点;原 time-context 只读型断言随 2026-11-11 裁定改写)', async () => {
    await attach()
    const result = await gateway.promptRollback({ versionId: 'v-none', entryId: 'runtime.memory.index-section' })
    expect(result.status).toBe('rejected')
    expect(result.issues?.[0]).toContain('运行时注入型')
    expect(result.issues?.[0]).toContain('无 patch 写回落点')
    expect((await gateway.snapshot()).pendingApproval).toBeNull()
  })

  // ---------- ⑥ 导入通道逐条目(与保存同门禁) ----------

  it('⑥ 导入超限/缺红线/stale 锁拒收未入库 + 审计 prompt-import.rejected 带 entryId;块标量导入反引一致(形态 A/B/C)', async () => {
    await attach()
    // 先造各形态的新版本并导出带 entryId 的包。
    const targets = [
      { entryId: 'domain.event-planning.persona-prefix', content: `${EVENT_PREFIX_V1} imported.` },
      { entryId: 'preset.cordis.persona', content: `Cordis import. ${RED_LINES}` },
      { entryId: 'preset.standard.plan-mode.section', content: 'Imported plan section.\n' },
    ] as const
    const packs: PromptExportPack[] = []
    for (const target of targets) {
      const { phase2 } = await saveTwoPhase(target.entryId, target.content)
      const versionId = phase2.version?.id
      expect(versionId).toBeDefined()
      const exported = await gateway.promptExport({ entryId: target.entryId, versionId: versionId as string })
      expect(exported.pack.entryId).toBe(target.entryId)
      packs.push(exported.pack)
    }
    // (a) 超限包拒收(checksum 造好,内容超限)。
    const oversizedContent = 'a'.repeat(65537)
    const oversizedPack: PromptExportPack = {
      ...packs[2] as PromptExportPack, persona: oversizedContent, checksum: sha256Hex(oversizedContent),
    }
    const oversizedResult = await gateway.promptImport({ pack: oversizedPack })
    expect(oversizedResult.status).toBe('rejected')
    expect(oversizedResult.issues?.join('\n')).toContain('65537 字节 > 65536')
    // (b) 缺红线包拒收(persona 类条目,issues 指明缺哪条)。
    const noRedLine = 'no red lines here'
    const noRedPack: PromptExportPack = { ...(packs[1] as PromptExportPack), persona: noRedLine, checksum: sha256Hex(noRedLine) }
    const noRedResult = await gateway.promptImport({ pack: noRedPack })
    expect(noRedResult.status).toBe('rejected')
    expect(noRedResult.issues?.join('\n')).toContain('「比选中立」')
    // (c) stale 锁拒收(内容须与现值不同,否则先命中 diff-empty 分支)。
    const staleContent = `${EVENT_PREFIX_V1} stale lock variant.`
    const stalePack: PromptExportPack = { ...(packs[0] as PromptExportPack), persona: staleContent, checksum: sha256Hex(staleContent) }
    const staleResult = await gateway.promptImport({ pack: stalePack, baseVersionId: 'v-bogus' })
    expect(staleResult.status).toBe('rejected')
    expect(staleResult.issues?.[0]).toContain('baseVersionId')
    // 拒收全部未入库:plan-mode 链仍 2(initial+save)。
    expect((await gateway.promptVersions({ entryId: 'preset.standard.plan-mode.section' }) as VersionsResult).total).toBe(2)
    // 审计:prompt-import.rejected 至少三条(超限/缺红线/stale 锁),均带 entryId。
    const rejectedAudits = (await waitForAudit(details =>
      details.filter(detail => detail['action'] === 'prompt-import.rejected').length >= 3))
      .filter(detail => detail['action'] === 'prompt-import.rejected')
    expect(rejectedAudits.length).toBeGreaterThanOrEqual(3)
    for (const detail of rejectedAudits.slice(-3)) {
      expect(typeof detail['entryId'], JSON.stringify(detail)).toBe('string')
    }
    // (d) 合法包导入(形态 A/B/C 各 1 例):内容取「与现值不同的终版变体」
    // (同校验类别:A 英文红线/B 标准红线/C 豁免),两段式 → committed → patch 层反引一致。
    const importVariants = [
      `${EVENT_PREFIX_V1} imported-final.`,
      `Cordis import final. ${RED_LINES}`,
      'Imported plan section final.\n',
    ] as const
    for (let i = 0; i < packs.length; i += 1) {
      const base = packs[i] as PromptExportPack
      const persona = importVariants[i] as string
      const pack: PromptExportPack = { ...base, persona, checksum: sha256Hex(persona) }
      const phase1 = await gateway.promptImport({ pack, author: 'carol' })
      expect(phase1.status, `pack(${base.entryId}) 应进审批:${JSON.stringify(phase1.issues)}`).toBe('approval-required')
      const phase2 = await gateway.promptImport({ pack, author: 'carol', approvalId: phase1.approval?.approvalId ?? '', approved: true })
      expect(phase2.status).toBe('committed')
      expect(phase2.version?.entryId).toBe(pack.entryId)
      expect(phase2.version?.source).toBe('import')
      // 导入后 patch 层反引一致(形态 A/B/C 专项判据)。
      expect(await currentText(pack.entryId ?? '')).toBe(persona)
    }
  })

  // ---------- 横切:TOCTOU / 审计 entryId ----------

  it('横切 1(TOCTOU):审批后 live patch 被外部改写 → 二段拒写零落盘,外部状态保持,版本零增长', async () => {
    await attach()
    const next = `${PERSONA_V1} v2`
    const phase1 = await gateway.promptSave({ content: next, author: 'alice' })
    expect(phase1.status).toBe('approval-required')
    // 外部改写(模拟 profile 升级合并):persona 行外任意合法改动即可(基线是全文)。
    const external = t16FixturePatch().replace('# T1.6 fixture:', '# T1.6 fixture(外部升级合并后):')
    writeFileSync(patchPath, external, 'utf8')
    const phase2 = await gateway.promptSave({ content: next, author: 'alice', approvalId: phase1.approval?.approvalId ?? '', approved: true })
    expect(phase2.status).toBe('rejected')
    expect(phase2.issues?.join('\n')).toContain('TOCTOU 拒写')
    expect(phase2.issues?.join('\n')).toContain('外部改写')
    // 文件保持外部改写后的状态(未覆盖他人改动);版本零增长。
    expect(readFileSync(patchPath, 'utf8')).toBe(external)
    expect((await gateway.promptVersions({})).total).toBe(1)
    // 刷新后重新发起(新基线)可正常完成。
    const retry1 = await gateway.promptSave({ content: next, author: 'alice' })
    const retry2 = await gateway.promptSave({ content: next, author: 'alice', approvalId: retry1.approval?.approvalId ?? '', approved: true })
    expect(retry2.status).toBe('committed')
  })

  it('横切:写链路审计事件带 entryId(既有 system/operator/versionId/at 之外只增字段)', async () => {
    await attach()
    const { phase2 } = await saveTwoPhase('domain.event-planning.persona-prefix', `${EVENT_PREFIX_V1} audited.`)
    const details = await waitForAudit(records =>
      records.some(detail => detail['action'] === 'prompt-save.committed' && detail['versionId'] === phase2.version?.id))
    const committed = details.find(detail => detail['action'] === 'prompt-save.committed' && detail['versionId'] === phase2.version?.id)
    expect(committed?.['entryId'], JSON.stringify(details)).toBe('domain.event-planning.persona-prefix')
    expect(committed?.['operator']).toBe('alice')
    expect(committed?.['system']).toBe('eterna-prompt-studio')
    const requested = details.find(detail => detail['action'] === 'prompt-save.approval-requested' && detail['entryId'] === 'domain.event-planning.persona-prefix')
    expect(requested?.['entryId']).toBe('domain.event-planning.persona-prefix')
    expect(typeof requested?.['approvalId']).toBe('string')
  })

  it('横切:未知 entryId 保存 rejected 明示;领域 pack 文件写后可再写(round-trip 稳定)', async () => {
    await attach()
    const unknown = await gateway.promptSave({ entryId: 'no.such.entry', content: 'x' })
    expect(unknown.status).toBe('rejected')
    expect(unknown.issues?.[0]).toContain('未知条目 id:no.such.entry')
    // 整文件条目(persona.md)写回=全文替换,读回一致。
    const mdId = 'domain.event-planning.persona-md'
    const original = await currentText(mdId)
    await saveTwoPhase(mdId, `# persona\n\n${EVENT_PREFIX_V1} T1.6 whole-file.\n`)
    expect(await currentText(mdId)).toBe(`# persona\n\n${EVENT_PREFIX_V1} T1.6 whole-file.\n`)
    const chain = await gateway.promptVersions({ entryId: mdId }) as VersionsResult
    await rollbackTwoPhase(chain.versions.at(-1)?.id ?? '')
    expect(await currentText(mdId)).toBe(original)
  })
})

describe('T2.6 promptRegistry 读取面(运行时注入条目自管,缺席降级不炸宿主)', () => {
  it('服务名常量=promptRegistry(与 @eterna/memory 导出面互为真值,registry.test.ts 源码交叉钉住)', () => {
    expect(PROMPT_REGISTRY_SERVICE_ID).toBe('promptRegistry')
  })

  it('插件 apply 即 provide;无版本条目返回 undefined 不抛;总 disposer 注销服务', () => {
    const ctx = new Context()
    const disposer = plugin.apply(asStudio(ctx))
    const face = ctx.get(PROMPT_REGISTRY_SERVICE_ID) as { resolveRuntimePromptText(entryId: string): string | undefined } | undefined
    expect(face).toBeDefined()
    expect(typeof face?.resolveRuntimePromptText).toBe('function')
    // 版本链未挂/链空 → undefined(消费侧 memory/glue 回落内置兜底文本,不炸装配)。
    expect(face?.resolveRuntimePromptText('runtime.memory.index-section')).toBeUndefined()
    expect(face?.resolveRuntimePromptText('runtime.glue.memory-plugin')).toBeUndefined()
    expect(face?.resolveRuntimePromptText('no.such.entry')).toBeUndefined()
    disposer()
    expect(ctx.get(PROMPT_REGISTRY_SERVICE_ID)).toBeUndefined()
  })

  it('缓存随版本链变化:runtime 条目入版本库 → refresh → 读取面返回新文;detach 清空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-registry-'))
    const patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, fixturePatch(), 'utf8')
    const unit = new MemoryUnit()
    const ctx = new Context()
    const gateway = new LoopPromptGateway(asStudio(ctx), { patchPath, sessionsRoot: join(dir, 'sessions'), auditFilePath: join(dir, 'audit.jsonl'), dryRunVerify: false })
    try {
      const backend = { kv: { open: async () => unit as unknown as KvUnit }, close: async () => undefined }
      await gateway.attachBackend(backend)
      expect(gateway.promptRegistryFace.resolveRuntimePromptText('runtime.memory.index-section')).toBeUndefined()
      const store = gateway.store
      expect(store).toBeDefined()
      const appendRuntime = (content: string) => (store as NonNullable<typeof store>).append({
        content, author: 'test', source: 'save', parentId: null, summary: 'T2.6', entryId: 'runtime.memory.index-section',
      })
      await appendRuntime('## 长期记忆(注册表版 V1)')
      await gateway.refreshRuntimePromptCache()
      expect(gateway.promptRegistryFace.resolveRuntimePromptText('runtime.memory.index-section')).toBe('## 长期记忆(注册表版 V1)')
      await appendRuntime('## 长期记忆(注册表版 V2)')
      await gateway.refreshRuntimePromptCache()
      expect(gateway.promptRegistryFace.resolveRuntimePromptText('runtime.memory.index-section')).toBe('## 长期记忆(注册表版 V2)')
      // detach(版本库释放)→ 缓存清空,读取面如实返回 undefined(消费侧回落兜底)。
      await gateway.detachStore()
      expect(gateway.promptRegistryFace.resolveRuntimePromptText('runtime.memory.index-section')).toBeUndefined()
    } finally {
      await gateway.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
