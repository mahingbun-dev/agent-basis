/**
 * 审计接线落痕单测(T8 三测之三:governance/egress 决策 → AuditRecord → 按日落盘)。
 *
 * 组合形态 = cordis.patch.yml 行序(governance → audit → egress):
 * - governance/egress 的 pre-execute 决策经组合层审计桥(src/audit-bridge.ts)直投
 *   ctx.audit.report → kind 'governance' 记录 → DailyFileAuditSink 按日落盘;
 * - 被拒调用同时由 session 事件流覆盖(tool/call+tool/result 配对,设计 §2.2-4:
 *   tool/call 先于 pre-execute 落账);
 * - ctx.audit.query 为宿主可查询面。
 * 包边界:@basis/governance 不 import @basis/audit —— 桥只在 glue(本包)。
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AuditWorld } from '@basis/audit'
import { AUDIT_SERVICE_ID } from '@basis/audit'
import { defineAuditPlugin } from '../src/plugins/audit-plugin.ts'
import { defineEgressPlugin } from '../src/plugins/egress-plugin.ts'
import { GOVERNANCE_SERVICE_ID, defineGovernancePlugin } from '../src/plugins/governance-plugin.ts'
import type { GovernanceWorld } from '../src/plugins/governance-plugin.ts'
import { makeFakeContext } from './fake-context.ts'

const T_DENIED = 1_760_000_000_000

const tempDirs: string[] = []
const disposers: (() => void)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

const RULES_YAML = `
rules:
  - { id: deny-rm, effect: deny, tools: ['shell*'], argsContains: ['rm -rf'] }
default: ask
`

/** 全链挂载(行序对齐 cordis.patch.yml:governance → audit → egress;规则文件先于 apply 落盘)。 */
async function mountAll() {
  const dir = await mkdtemp(join(tmpdir(), 'basis-glue-audit-trail-'))
  tempDirs.push(dir)
  const rulesPath = join(dir, 'governance.rules.yml')
  await writeFile(rulesPath, RULES_YAML, 'utf8')
  const harness = makeFakeContext()
  disposers.push(defineGovernancePlugin({ rulesPath }).apply(harness.fake as unknown as Context))
  const auditDir = join(dir, 'audit')
  disposers.push(defineAuditPlugin({ dir: auditDir }).apply(harness.fake as unknown as Context))
  disposers.push(defineEgressPlugin().apply(harness.fake as unknown as Context))
  return {
    harness,
    auditDir,
    audit: harness.service(AUDIT_SERVICE_ID) as AuditWorld | undefined,
    governance: harness.service(GOVERNANCE_SERVICE_ID) as GovernanceWorld | undefined,
  }
}

async function readAllRecords(dir: string): Promise<Record<string, unknown>[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).sort()
  const lines: string[] = []
  for (const name of names) {
    lines.push(...(await readFile(join(dir, name), 'utf8')).trim().split('\n').filter(line => line.length > 0))
  }
  return lines.map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('审计接线:governance/egress 决策落 DailyFileAuditSink', () => {
  it('governance deny 直投 kind governance 记录(按日文件 + actor 插件粒度)', async () => {
    const { harness, auditDir, audit } = await mountAll()
    const decision = await harness.dispatchPreExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } })
    expect(decision.kind).toBe('deny')
    await audit?.trail.flush()

    const records = await readAllRecords(auditDir)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'governance',
      detail: {
        source: 'glue-governance',
        event: 'tools/pre-execute',
        tool: 'shell',
        decision: 'deny',
      },
      actor: { pluginId: 'basis-governance', source: 'decision' },
    })
    const detail = records[0]?.detail as Record<string, unknown> | undefined
    expect(String(detail?.reason)).toContain('deny-rm')
  })

  it('egress 域名拒绝直投 kind governance 记录(结构化 denied.layer=domain)', async () => {
    const { harness, auditDir, audit } = await mountAll()
    const decision = await harness.dispatchPreExecute({ name: 'web_fetch', arguments: { url: 'https://example.com/x' } })
    expect(decision.kind).toBe('deny')
    await audit?.trail.flush()

    const records = await readAllRecords(auditDir)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'governance',
      detail: {
        source: 'glue-egress',
        tool: 'web_fetch',
        decision: 'deny',
        denied: { egress: 'denied', tool: 'web_fetch', layer: 'domain' },
      },
      actor: { pluginId: 'basis-egress', source: 'decision' },
    })
  })

  it('被拒调用同时由 session 事件流覆盖(tool/call+tool/result 配对,isError)', async () => {
    const { harness, auditDir, audit } = await mountAll()
    await harness.dispatchPreExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } })

    // 内核事实(batch.ts:157-159,247,256):tool/call 先于 pre-execute 落账,被拒调用
    // 以 tool/result(isError:true)收尾 —— 事件流兜底,无需决策路径插桩。
    harness.emitSession({ type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'shell', arguments: '{"cmd":"rm -rf /"}' }, seq: 1, time: T_DENIED })
    harness.emitSession({ type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: 'c1', isError: true } }, seq: 2, time: T_DENIED })
    await audit?.trail.flush()

    const toolCallRecords = (await readAllRecords(auditDir)).filter(record => record['kind'] === 'tool-call')
    expect(toolCallRecords).toHaveLength(1)
    expect(toolCallRecords[0]).toMatchObject({ tool: 'shell', callId: 'c1', isError: true, turn: 1 })
  })

  it('ctx.audit.query 为宿主可查询面(kinds 过滤 + limit)', async () => {
    const { harness, auditDir, audit } = await mountAll()
    await harness.dispatchPreExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } }) // governance deny
    await harness.dispatchPreExecute({ name: 'web_fetch', arguments: { url: 'https://example.com/x' } }) // egress deny
    harness.emitSession({ type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'shell', arguments: '{}' }, seq: 1, time: T_DENIED })
    harness.emitSession({ type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: 'c1', isError: true } }, seq: 2, time: T_DENIED })
    await audit?.trail.flush()

    const governancePage = await audit?.query({ kinds: ['governance'], limit: 10 })
    expect(governancePage?.records).toHaveLength(2)
    expect(governancePage?.records.every(record => record.kind === 'governance')).toBe(true)

    const toolPage = await audit?.query({ kinds: ['tool-call'], isError: true, limit: 10 })
    expect(toolPage?.records).toHaveLength(1)
    expect(toolPage?.records[0]).toMatchObject({ tool: 'shell', isError: true })

    // 按日文件名口径:<prefix>YYYYMMDD.jsonl
    const names = await readdir(auditDir)
    expect(names.some(name => /^audit-\d{8}\.jsonl$/u.test(name))).toBe(true)
  })
})
