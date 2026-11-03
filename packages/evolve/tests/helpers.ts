/**
 * 测试 fixture:用 @basis/packctl 的 initPack 生成合法 demo pack(T5 模板),
 * 再覆写 skills/core-workflow/SKILL.md(双条目 + 既有引用)并添加 G1 的
 * replay smoke case(evals/ 顶层 + fixtures/<case>.jsonl 终态快照)。
 * 产物原样通过 packctl lint(G0)与 evals replay(G1)—— e2e 与 gates 共用。
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { initPack } from '@basis/packctl'

export const PACK_NAME = '@evodemo/pack'
export const SKILL_REL = 'skills/core-workflow/SKILL.md'

export const DEMO_SKILL_MD = `---
name: core-workflow
description: 活动策划演示领域核心工作流。接到活动策划任务时的默认入口。
metadata:
  evo:
    entries:
      - { id: S-core-workflow-001, helpful: 4, harmful: 0, updated: 2026-10-01, origin: init }
      - { id: S-core-workflow-002, helpful: 1, harmful: 0, updated: 2026-10-02, origin: init }
---
## 步骤

<!-- E: S-core-workflow-001 -->
1. 明确任务目标与硬约束(预算 / 时限 / 合规);
2. 按 hitl.yaml 判定风险档位:R2+ 先取审批再动手;
3. 收尾自查:[执行检查表](references/checklist.md)。
<!-- /E -->

## 注意

<!-- E: S-core-workflow-002 -->
交付物一律先落草稿文件再交付,禁止直接对外发射。
<!-- /E -->
`

/** G1 smoke case(evals 顶层;replay adapter 读 fixtures/smoke-evolution.jsonl)。 */
export const SMOKE_CASE_YAML = `id: smoke-evolution
description: 演示 replay 冒烟(终态文件 + 轨迹 + 答案三断言)
user_input: 按核心工作流处理演示任务
tags: [smoke]
answer:
  contains: 条目
final_state:
  - file_assert: { path: out/result.md, contains: ok }
trajectory:
  must_call: [read_file]
  must_not_call: [send_group_message]
  max_steps: 30
budget: { max_tokens: 100000 }
`

/**
 * 覆写 init 模板的 evals/golden/case-001.yaml:@basis/packctl 的 GOLD 检查接受
 * 模板原样,但 @basis/evals 的严格 schema 要求 answer 为对象形态 —— 这里替换为
 * 两个 loader 都接受的形态(tags 非 smoke,G1 不执行,仅保证加载零错误)。
 */
export const GOLDEN_CASE_YAML = `id: case-001
description: packctl init 模板示例 case(双 loader 兼容形态)
user_input: (示例任务输入:演示 pack 的模板 case)
tags: [golden]
final_state:
  - file_assert: { path: out/deliverable.md, contains: demo }
trajectory:
  must_call: []
  must_not_call: []
  max_steps: 30
budget: { max_tokens: 200000 }
`

/** replay fixture:turn → tool/call(read_file)→ assistant/message + 终态工作区快照。 */
export const SMOKE_FIXTURE_JSONL = [
  { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
  { type: 'tool/call', seq: 2, time: 2, data: { turn: 1, step: 1, callId: 'c1', name: 'read_file', arguments: '{"path":"NOTES.md"}' } },
  {
    type: 'assistant/message', seq: 3, time: 3, data: {
      message: { content: [{ type: 'text', text: '已按条目完成自查,产出草稿。' }] },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    },
  },
  {
    type: 'plugin:basis-evals/workspace', seq: 4, time: 4, data: {
      files: { 'out/result.md': 'ok: deliverable drafted\n' },
    },
  },
].map(line => JSON.stringify(line)).join('\n') + '\n'

export interface DemoPack {
  readonly rootDir: string
  readonly packDir: string
}

/** 生成 demo pack(tmp 目录);用例结束由调用方 rm。 */
export async function makeDemoPack(): Promise<DemoPack> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-evolve-'))
  const init = initPack('evodemo', { rootDir })
  if (init.result === undefined) {
    throw new Error(`demo pack init 失败:${JSON.stringify(init.findings)}`)
  }
  const packDir = init.result.packDir
  await fs.writeFile(path.join(packDir, SKILL_REL), DEMO_SKILL_MD, 'utf8')
  await fs.writeFile(path.join(packDir, 'evals/smoke-evolution.yaml'), SMOKE_CASE_YAML, 'utf8')
  await fs.writeFile(path.join(packDir, 'evals/golden/case-001.yaml'), GOLDEN_CASE_YAML, 'utf8')
  await fs.mkdir(path.join(packDir, 'fixtures'), { recursive: true })
  await fs.writeFile(path.join(packDir, 'fixtures/smoke-evolution.jsonl'), SMOKE_FIXTURE_JSONL, 'utf8')
  return { rootDir, packDir }
}

export async function rmPack(pack: DemoPack): Promise<void> {
  await fs.rm(pack.rootDir, { recursive: true, force: true })
}
