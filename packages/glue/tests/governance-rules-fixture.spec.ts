/**
 * 容器默认治理规则集防漂移单测(2026-11-10「完全权限全拒」事故修复,方案 A)。
 *
 * 事故链:镜像内无 .eterna/governance.rules.yml → governance-plugin 空规则集 →
 * fail-closed 默认 ask 打在每个调用上 × 完全权限档 approval=never 确定性 rejected
 * = 静默全拒。修复 = docker/entrypoint.sh 步骤 2.6 渲染 docker/profile/
 * governance.rules.yml。本测试钉住三件事:
 * 1. 规则文件始终可通过 RuleEngine 严格校验(default 只允许 ask|deny,解析期拒绝 allow);
 * 2. 清单内工具逐名 allow——名字是从 deepseek-harness 源码逐字对账的
 *    (见规则文件头注),上游改名/eterna patch 换工具而规则没跟上时在此红灯;
 * 3. 清单外未知工具仍走 default: ask(fail-closed 底线未被规则文件悄悄放宽)。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RuleEngine } from '@eterna/governance'

const RULES_PATH = fileURLToPath(new URL('../../../docker/profile/governance.rules.yml', import.meta.url))

/** eterna-web 档(standard + cordis 预设)实际注册的模型面工具全名单。 */
const ETerna_WEB_TOOLS: readonly string[] = [
  'bash',
  'read', 'write', 'edit', 'read_image',
  'glob', 'grep',
  'todo_write', 'exit_plan_mode',
  'ask_user_question', 'present',
  'web_fetch', 'web_search',
  'job_list', 'job_output', 'job_kill',
  'schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit',
  'skill',
  'create_goal', 'get_goal', 'update_goal',
  'subagent', 'subagent_fork', 'list_subagent_models',
  'workflow', 'cordis_inspect_list', 'cordis_inspect_query',
  'list_agents', // ← subagent/tool-subagent-control/src/list-agents.ts(2026-11-10 PH-3 补遗)
  'memory_write', 'memory_read', 'memory_search', 'memory_forget', // ← @eterna/memory MEMORY_TOOL_NAMES(2026-11-13 补遗)
  // ── 2026-11-13 二批(session-7e15e6ab 挂死事故:52 工具全名单对账,未列名=挂死在不可见审批)──
  'mcp__browser__browser_snapshot', 'mcp__browser__browser_click', 'mcp__browser__browser_fill', // ← browser-relay mcp.ts
  'knowledge_propose', 'knowledge_read', 'knowledge_search', 'knowledge_status', // ← @eterna/glue knowledge 插件
  'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource', // ← 上游 mcp 资源面
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update', // ← 上游 team 协作族
  'send_message', 'spawn_teammate', 'wait_agent', 'interrupt_agent', // ← 上游 team 协作族
  'create_worktree', // ← 上游 workspace 工作树(working_directory 刻意不列,见规则文件尾注)
]

describe('容器默认治理规则集(docker/profile/governance.rules.yml)', () => {
  const engine = RuleEngine.parse(readFileSync(RULES_PATH, 'utf8'), RULES_PATH)

  it('解析通过且 default 保持 fail-closed ask', () => {
    expect(engine.policy.default).toBe('ask')
    expect(engine.policy.rules.length).toBeGreaterThan(0)
  })

  it('每条规则的 tools/reason 非空(审批卡片与审计可读)', () => {
    for (const rule of engine.policy.rules) {
      expect(rule.tools.length, `规则 ${rule.id} 的 tools 不得为空`).toBeGreaterThan(0)
      expect(rule.reason, `规则 ${rule.id} 缺 reason`).not.toBe('')
    }
  })

  it('eterna-web 档全名单工具逐名 allow(防上游改名漂移)', () => {
    for (const tool of ETerna_WEB_TOOLS) {
      const evaluation = engine.evaluateCall({ name: tool })
      expect(evaluation.decision, `工具 ${tool} 应被规则显式 allow`).toBe('allow')
      expect(evaluation.isDefault, `工具 ${tool} 的 allow 不得来自 default(必须命中具名规则)`).toBe(false)
    }
  })

  it('规则清单恰好覆盖全名单,无冗余 glob(对账纪律:多列=放行未注册工具,少列=漏放行)', () => {
    const allowlisted = new Set(engine.policy.rules.flatMap(rule => rule.tools))
    expect([...allowlisted].sort()).toEqual([...ETerna_WEB_TOOLS].sort())
  })

  it('清单外未知工具仍 fail-closed 走 default ask', () => {
    const evaluation = engine.evaluateCall({ name: 'definitely_not_a_registered_tool' })
    expect(evaluation.decision).toBe('ask')
    expect(evaluation.isDefault).toBe(true)
  })

  // ── deny 族:凭据面隔离(session-7e15e6ab 事故:模型经 bash 收割 relay/用户令牌
  // 直连 relay 绕过工具管线)。argsContains 子串命中即 deny,优先于 allow-shell/fs。──
  it('凭据面 deny:令牌文件/内网端口命中即拒,优先于 allow(deny > allow)', () => {
    const denials: ReadonlyArray<readonly [string, unknown]> = [
      ['bash', { command: 'cat /data/relay-token' }],
      ['bash', { command: 'curl -s http://127.0.0.1:9310/api/tools -H "x-relay-token: x"' }],
      ['bash', { command: 'cat /data/access/companion-tokens.json' }],
      ['read', { path: '/data/relay-token' }],
      ['grep', { pattern: 'relay-token', path: '/data' }],
    ]
    for (const [tool, args] of denials) {
      const evaluation = engine.evaluateCall({ name: tool, arguments: args })
      expect(evaluation.decision, `${tool} 触碰凭据面应 deny:${JSON.stringify(args)}`).toBe('deny')
    }
  })

  it('deny 不误伤常规调用:良性命令仍走 allow-shell/fs', () => {
    const benign: ReadonlyArray<readonly [string, unknown]> = [
      ['bash', { command: 'ls -la /data/workspaces' }],
      ['bash', { command: 'cat package.json | head' }],
      ['read', { path: '/data/workspaces/Mr.Ma/README.md' }],
    ]
    for (const [tool, args] of benign) {
      const evaluation = engine.evaluateCall({ name: tool, arguments: args })
      expect(evaluation.decision, `${tool} 良性调用不应被凭据面误伤:${JSON.stringify(args)}`).toBe('allow')
    }
  })
})
