/**
 * pack init <industry> —— 按 06 号 SOP §2 领域包模板生成骨架。
 *
 * 产物清单(与 06 号模板一一对应,额外含 cordis.patch.yml —— 它由
 * package.json 的 dsh.bundle.patch 指向,是 bundle 的实体):
 *
 *   package.json / cordis.patch.yml / profile.yml / persona.md
 *   skills/<sample>/SKILL.md(条目化)+ references/
 *   tools/index.ts + tools/sample-tool.ts(注册表 + 唯一 ID 形态)
 *   knowledge/README.md / policies/guard-rules.yml
 *   evals/{golden/case-001.yaml, validators/, trajectories/, threshold.yml}
 *   hitl.yaml
 *
 * 约束:init 产物必须原样通过 pack lint 与 pack check(单测钉住,防模板漂移)。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { error } from './types.ts'
import type { Finding } from './types.ts'

const INDUSTRY_RE = /^[a-z][a-z0-9-]*$/

export interface InitOptions {
  /** 目标根目录:生成 <root>/packs/<industry>/。 */
  readonly rootDir: string
}

export interface InitResult {
  readonly packDir: string
  /** 生成的全部文件(相对 pack 根)。 */
  readonly files: readonly string[]
}

/** 校验行业标识并生成骨架;行业名不合法或目标已存在时返回 findings。 */
export function initPack(industry: string, options: InitOptions): { result?: InitResult; findings: readonly Finding[] } {
  if (!INDUSTRY_RE.test(industry)) {
    return {
      findings: [error('INIT001', industry, '行业标识必须是 kebab-case 小写字母数字(同时用作目录名与 npm scope:@<industry>/pack)')],
    }
  }
  const packDir = join(options.rootDir, 'packs', industry)
  if (existsSync(join(packDir, 'package.json'))) {
    return { findings: [error('INIT002', packDir, '目标已存在(package.json 已在)——init 不覆盖,请在原包上迭代')] }
  }

  const files = Object.entries(buildTemplates(industry))
  for (const [rel, content] of files) {
    const abs = join(packDir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return { result: { packDir, files: files.map(([rel]) => rel).sort() }, findings: [] }
}

// ── 模板(全部函数:唯一入参 industry,保证单测可对任意行业生成)────────────

function buildTemplates(industry: string): Readonly<Record<string, string>> {
  const packName = `@${industry}/pack`
  const today = new Date().toISOString().slice(0, 10)
  return {
    'package.json': `${JSON.stringify({
      name: packName,
      version: '0.1.0',
      private: true,
      type: 'module',
      description: `${industry} 领域包(L2):persona + skills + 行业工具 + policies + golden set + hitl 分档。模板见 06 号 SOP §2。`,
      dsh: {
        manifestVersion: 1,
        bundle: { patch: './cordis.patch.yml' },
      },
    }, null, 2)}\n`,

    'cordis.patch.yml': `# ${packName} 领域包 bundle patch(06 号 SOP §2 模板)。
# dsh-base 先插入;本层按 id 覆写 base 行的 config(patch 替换整份 config,每个覆写行
# 重述自己拥有的全部键),并 insert 领域自有行;profile 的 cordis.patch.yml 最后生效。

# 领域 skills 单根收敛:dsh-skill-filesystem 只发现根级 <name>/SKILL.md(不嵌套),
# customSkillDirs 指向本包 skills/(相对路径,pack check 校验其存在)。
- id: skill-filesystem
  config:
    customSkillDirs: ['./skills']

# 领域 persona:全文见 persona.md,由组合层注入;prefix 先钉一句领域身份。
- id: system-prompt
  config:
    personaPrefix: >-
      You are a senior ${industry} domain specialist. Follow the pack persona and hard constraints.

# 领域工具插件(注册表 + 唯一 ID 形态,packctl lint 强制)。
# TODO(安装期): 真实安装前把 name 换成构建产物(如 ./tools/index.js,需加打包步骤);
# 装卸无残留冒烟需要 DSH 运行时,列入 blockers(14 号文档 §4)。
- insert:
    - id: ${industry}-tools
      name: './tools/index.ts'
`,

    'profile.yml': `# profile.yml —— 领域包 profile 叠加声明(06 号模板:继承 dsh-base,叠加 L1 基座 bundles 与本包)。
# L1 基座包随排期落地后在此追加:@basis/memory / @basis/interact / @basis/evals / @basis/knowledge …
name: ${industry}
extends:
  - dsh-base
bundles:
  - '@basis/governance'
  - '${packName}'
`,

    'persona.md': `# persona —— ${industry} 领域专家(06 号 SOP S1 分诊:只有「角色 / 语气 / 全局硬约束」允许进 prompt)

## 角色

你是资深 ${industry} 领域专家:既有领域判断力,又有执行力与预算/合规意识。
面对任务先澄清目标与约束,再给方案;交付物优先用文件落地(docx/xlsx/md)。

## 语气

- 结论先行,依据带出处(引用知识条目或文档路径);
- 不确定就问,不用猜测填补事实;数字必须可复核。

## 全局硬约束(红线;由 policies/guard-rules.yml 与 hitl.yaml 强制执行,此处仅声明)

1. 高危动作(R2/R3)必须走审批,静默执行 = 失败(golden 审批红线案例钉住);
2. 对外发射(发送/提交/付款/签署)一律 withhold-或-补偿,不做裸发射;
3. 预算、法务、批量外发类操作宁可升级,不可代理拍板。
`,

    'skills/core-workflow/SKILL.md': `---
name: core-workflow
description: ${industry} 领域核心工作流(示例 skill,S1 分诊后用真实 SOP 逐条替换)。接到 ${industry} 任务时的默认入口。
metadata:
  evo:
    entries:
      - { id: S-core-workflow-001, helpful: 0, harmful: 0, updated: ${today}, origin: init }
---
## 步骤

<!-- E: S-core-workflow-001 -->
1. 明确任务目标与硬约束(预算 / 时限 / 合规);
2. 按 hitl.yaml 判定风险档位:R2+ 先取审批再动手;
3. 执行并产出交付物,golden case 的终态断言就是验收口径;
4. 收尾自查:[执行检查表](references/checklist.md)。
<!-- /E -->
`,

    'skills/core-workflow/references/checklist.md': `# 执行检查表(core-workflow references)

- [ ] 目标与约束已与需求方对齐
- [ ] 风险档位已判定,R2+ 已取审批
- [ ] 交付物通过对应 golden case 的终态断言
- [ ] 引用与出处可追溯
`,

    'tools/index.ts': `/**
 * ${industry} 领域工具注册入口(组合层从这里取插件模块)。
 * 每个工具模块保持「注册表 + 唯一 ID」形态(packctl lint CORD002/003 强制)。
 */
export { createSampleTool, SAMPLE_TOOL_SERVICE_ID } from './sample-tool.ts'
export type { SampleTool } from './sample-tool.ts'
`,

    'tools/sample-tool.ts': `/**
 * ${industry} 领域工具样例(pack init 生成;S2 实现时替换为真实 defineTool 插件)。
 *
 * Cordis 纪律形态:
 * - 注册表 + 唯一 ID:@${industry}/sample-tool(packctl lint CORD004 校验命名空间);
 * - 纯函数实现:无旁路全局、无裸定时器(CORD001);副作用型工具在组合层
 *   以 effect 配逆闭包注册(逆闭包 = 卸载/撤销时可执行的真撤销)。
 */

/** 唯一 ID(注册表键;@<industry>/* 命名空间)。 */
export const SAMPLE_TOOL_SERVICE_ID = '@${industry}/sample-tool'

/** 可交换接口:任何提供同等 id 与能力的实现可整体替换本模块。 */
export interface SampleTool {
  readonly id: typeof SAMPLE_TOOL_SERVICE_ID
  /** 领域术语查询:确定性纯查询(R0 只读档),无副作用。 */
  lookup(term: string): string | undefined
}

const GLOSSARY: Readonly<Record<string, string>> = {
  sop: '标准作业程序(Standard Operating Procedure)',
  golden: '金标准任务:输入 + 终态断言 + rubric',
  hitl: 'Human-in-the-Loop 风险分档(R0 只读 ~ R3 高危)',
}

export function createSampleTool(): SampleTool {
  return {
    id: SAMPLE_TOOL_SERVICE_ID,
    lookup(term) {
      return GLOSSARY[term.toLowerCase()]
    },
  }
}
`,

    'knowledge/README.md': `# knowledge/ —— 领域语料元数据(06 号模板)

权威知识(制度/手册/案例库)不落本地:检索走 @basis/knowledge 插件
(WeKnora / wiki-local 后端,08 号文档 §5.1 边界)。本目录只放:

- 语料清单与版本(哪个知识库、哪个版本、负责人);
- 检索配置片段(后端选择、KB id、权限范围)。

经验性记忆(用户偏好、项目事实)归 @basis/memory,两者不互写。
`,

    'policies/guard-rules.yml': `# guard-rules.yml —— 合规红线(@basis/governance 规则引擎消费;deny 优先、fail-closed)。
# 格式对齐 @basis/governance PolicyDocument:{ rules: [{ id, effect, tools, argsContains?, reason? }], default }。
rules:
  - id: ${industry}-allow-readonly
    effect: allow
    tools: ['*_search', 'read_*', 'list_*']
    reason: 只读检索(R0 档)
  - id: ${industry}-ask-external-write
    effect: ask
    tools: ['send_*', 'submit_*', 'publish_*']
    reason: 对外发射类动作必须确认(R2 档,withhold-或-补偿)
  - id: ${industry}-deny-payment
    effect: deny
    tools: ['pay_*', 'sign_*']
    reason: 资金/法务效力动作禁止 agent 直接执行(R3 档,升级给人)
default: ask
`,

    'hitl.yaml': `# hitl.yaml —— 风险分档与升级触发器(08 号文档 §6.1;@basis/interact 消费、governance 执行)。
# 档位:R0 只读静默 / R1 可逆写静默+事后变更卡片 / R2 需确认审批 / R3 高危升级+冷静期。
industry: ${industry}
escalation_contact: '' # R3 升级到指定人;留空 = 升级给当前用户
on_no_answer: suspend # 无人值守 ask 不可达:挂起而非失败(approval 事件已持久,replay 即恢复)
rules:
  - id: hl-readonly
    risk: R0
    match: { tools: ['*_search', 'read_*', 'list_*'] }
  - id: hl-reversible-write
    risk: R1
    match: { tools: ['write_*', 'draft_*'] }
  - id: hl-external-effect
    risk: R2
    match: { tools: ['send_*', 'submit_*', 'publish_*'] }
  - id: hl-irreversible
    risk: R3
    match: { tools: ['pay_*', 'sign_*', 'approve_*'] }
`,

    'evals/golden/case-001.yaml': `# golden case(07 号文档 §3.2 字段口径;与 ai-evo Excel/终态校验器/轨迹断言同源)。
# S0 立项时与 SME 一起替换为真实任务;审批红线类案例(静默通过=失败)必含。
id: case-001
user_input: |
  (示例任务输入:S0 立项时替换为 ${industry} 领域的真实 golden task)
answer: |
tags: [示例]
final_state:
  file_assert: { path: 'out/deliverable.md', contains: [] }
trajectory:
  must_call: []
  must_not_call: []
  max_steps: 30
  approval_flow: []
budget: { max_tokens: 200000, max_cost_cny: 1.0, cache_hit_rate_min: 0.7 }
`,

    'evals/threshold.yml': `# threshold.yml —— 门禁阈值(07 号文档 §3;与 ai-evo 门禁配置同源)。
smoke:
  subset: 20
  timeout_min: 10
  verification_pass_rate_min: 0.8
release:
  verification_pass_rate_min: 0.85
  trajectory_match_rate_min: 0.8
  judge_score_min: 4.0
cache_hit_rate_min: 0.7
`,

    'evals/validators/README.md': `# validators/ —— 终态断言脚本(07 号文档 §3.2 final_state 四类口径)

file_assert / http_assert / db_assert / script;确定性优先:能写断言不写 judge。
`,

    'evals/trajectories/README.md': `# trajectories/ —— 轨迹断言(工具序列;四模式对齐 ai-evo + forbidden 调用)

strict / unordered / subset / superset;审批红线案例用 approval_flow 断言
(如预算超支变更必须触发 R3 审批,静默通过 = 失败)。
`,
  }
}
