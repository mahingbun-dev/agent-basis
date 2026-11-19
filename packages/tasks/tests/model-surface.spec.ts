/**
 * model-surface 漂移测试(35 号 A23 验收门禁「体积预算快照」;24 §8.1-6 模型面 drift
 * 测试纪律;34 号 §4 model-surface.spec 行)。
 *
 * 本文件在 A23 时点看护的模型面(本包已落地面):
 * - prompt 资产清单:prompts/VERSIONS.md 的版本表 ↔ 11 件资产实际内容 hash 逐件一致;
 * - 体积预算(★按字符,中文化重标定——禁止沿用 SA 英文预算,35 号 §12-9):双角色
 *   装配后 system prompt(机器相关变量值与规则行剥离后)≤ BUDGET;
 * - 内置件清单与装配顺序快照(PART_KEYS/分段名序);
 * - prompt 文本中文为主 guard(每件资产含 CJK);
 * - 资产引用的 orchestrator_* 工具名 token 快照(新引用=有意识变更)。
 *
 * A20 落地后本文件扩展:orchestrator 14/worker 6 工具清单快照与工具 schema 计入
 * BUDGET(34 号 §4 model-surface 行「工具清单」);A24 的活跃工单清单 section 体积预算
 * (28 号 §6 末段;35 号 A24/表⑥-8;G2-A8「含 model-surface 体积断言」)落
 * tests/active-tickets.spec.ts——清单以独立 section 注入、不进 prompts.compose 分段
 * 装配,其预算(ACTIVE_TICKETS_BUDGET_CHARS)与本文件双角色 BUDGET 互不挤占。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Store } from '../src/store/store.ts'
import {
  builtInParts, composePrompt, defaultPrompts, PART_KEYS, promptFile, promptParts, Prompts,
} from '../src/session/prompts.ts'

/** 11 件资产(35 号 A23 交付面;cli.md 与 team/ 不在 34 §1 清单,不登记——35 §12-18)。 */
const ASSETS = ['orchestrator', 'dispatch', 'worker', 'shared', 'replies', 'subscriptions', 'admission', 'work',
  'handoff', 'handoff-orchestrator', 'handoff-worker'] as const

/** 内容派生版本键(与 src/core/ids.ts 的 key 同构:sha256(域, 文本) 前 32 位)。 */
const version = (text: string): string => createHash('sha256').update(JSON.stringify(['prompt-asset', text])).digest('hex').slice(0, 32)

/**
 * 双角色 system prompt 的字符预算(按字符,非字节;≈实测基线 +5% 余量,SA model-surface
 * 的 "~5% above baseline" 惯例)。2026-11-17 中文重写后实测:orchestrator 10_122 字符、
 * worker 6_486 字符(默认 settings、无规则、环境变量值剥离)。收窄模型面文本时应下调;
 * 上调必须是有意为之并在提交说明里给出理由。A20 工具面落地后工具 schema 计入并重标。
 */
const BUDGET: Record<'orchestrator' | 'worker', number> = { orchestrator: 10_700, worker: 6_850 }

/** 资产里引用的 orchestrator_* 工具名(A20 工具面落地后对照注册表核对;此处看护漂移)。 */
const TOOL_TOKENS = ['orchestrator_route', 'orchestrator_read', 'orchestrator_eval', 'orchestrator_eval_read',
  'orchestrator_eval_decide', 'orchestrator_reply', 'orchestrator_report', 'orchestrator_ack',
  'orchestrator_thread_unsubscribe', 'orchestrator_thread_unrelated', 'orchestrator_trigger_handback',
  'orchestrator_trigger_requeue', 'orchestrator_ticket_request_status'] as const

const manifest = readFileSync(fileURLToPath(new URL('../prompts/VERSIONS.md', import.meta.url)), 'utf8')

describe('prompt 资产与版本清单(35 号 A23)', () => {
  it('VERSIONS.md 的版本表与 11 件资产实际内容逐件一致(漂移即失败)', () => {
    for (const name of ASSETS) {
      const hash = version(promptFile(name))
      expect(manifest, `${name}.md 的版本未登记进 VERSIONS.md`).toContain(hash)
    }
    // 清单登记的 11 行都指向现存资产(无悬空 hash)。
    const hashes = [...manifest.matchAll(/\| ([0-9a-f]{32}) \|/g)].map(match => match[1]!)
    expect(hashes).toHaveLength(ASSETS.length)
    expect(new Set([...ASSETS.map(name => version(promptFile(name)))]).size).toBe(ASSETS.length)
  })

  it('prompt 文本中文为主:每件资产含 CJK 字符(34 §6-9 本地化 guard)', () => {
    for (const name of ASSETS) expect(promptFile(name), `${name}.md 应为中文为主`).toMatch(/[\u4e00-\u9fff]/)
  })

  it('资产引用的工具名 token 不漂移:新增/移除 orchestrator_* 引用须同步本快照', () => {
    const found = new Set<string>()
    for (const name of ASSETS) for (const [token] of promptFile(name).matchAll(/\borchestrator_[a-z_]+/g)) found.add(token)
    expect([...found].sort()).toEqual([...TOOL_TOKENS].slice().sort())
  })
})

describe('模型面快照(24 §8.1-6;34 号 §4 model-surface 行)', () => {
  it('内置件清单快照:PART_KEYS 13 件(runtime 11 资产 + environment + policy/none + policy)', () => {
    expect([...PART_KEYS].sort()).toEqual(['runtime/admission', 'runtime/dispatch', 'runtime/environment',
      'runtime/handoff/orchestrator', 'runtime/handoff/worker', 'runtime/orchestrator', 'runtime/policy',
      'runtime/policy/none', 'runtime/replies', 'runtime/shared', 'runtime/subscriptions', 'runtime/work',
      'runtime/worker'].slice().sort())
    expect(Object.keys(builtInParts())).toHaveLength(PART_KEYS.length)
  })

  it('装配分段顺序快照:双角色分段名序(增删分段=有意识变更)', () => {
    const names = (role: 'orchestrator' | 'worker') => promptParts(defaultPrompts(), role, 'env').map(part => part.name)
    expect(names('orchestrator')).toEqual(['runtime/shared', 'runtime/orchestrator', 'runtime/subscriptions',
      'runtime/replies', 'runtime/dispatch', 'runtime/admission', 'runtime/handoff', 'runtime/environment'])
    expect(names('worker')).toEqual(['runtime/shared', 'runtime/worker', 'runtime/subscriptions',
      'runtime/replies', 'runtime/work', 'runtime/handoff', 'runtime/environment'])
  })

  it.each(['orchestrator', 'worker'] as const)('%s 装配 prompt 在字符预算内(中文重标定,按字符)', (role) => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-model-surface-'))
    const store = new Store('alice', { tenantRoot: dir })
    try {
      const prompts = new Prompts(store)
      const composed = prompts.compose(defaultPrompts(), role, '- DSH_TASKS_DEMO = "acme/widgets": 演示变量。')
      // 剥离机器相关的变量值后计长(SA model-surface 同款口径)。
      const text = composed.replace(/ = "[^"\n]*"/g, ' = ""')
      expect(text.length, `${role}: ${text.length} 字符的 prompt(预算 ${BUDGET[role]})`).toBeLessThanOrEqual(BUDGET[role])
      // 装配纯函数面同一口径(不经 store)。
      expect(composePrompt(defaultPrompts(), role).length).toBeGreaterThan(0)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })

  it('SA 英文预算不沿用:中文预算显著低于 SA 基线(orchestrator 59_000/worker 40_500 的 1/4 以下)', () => {
    // 防呆:若有人把预算抄回 SA 数值(59_000/40_500),该断言失败——35 号 §12-9 禁止沿用。
    expect(BUDGET.orchestrator).toBeLessThan(59_000 / 4)
    expect(BUDGET.worker).toBeLessThan(40_500 / 4)
  })
})
