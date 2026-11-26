/**
 * 模型菜单会话归属(2026-11-25 实机回归钉)。
 *
 * 故障:打开参谋面板后,主会话切模型报
 * `session "<父>--adviser-2" is owned by subagent routing`(session/agent-busy)。
 * 两条根因,这里各钉一条护栏:
 * 1. 会话桥探针在参谋(子会话)的输入区也渲染,「最后写入者」把桥覆盖成子会话;
 *    ⇒ 注册侧必须按上游 `sessions.subagentAddress` 注入子会话判定,探针拒写。
 * 2. 模型菜单是 body 级命令式挂载,只靠全局桥取会话;
 *    ⇒ 打开前先按**按钮所属对话**的 `data-conversation-session` 解析,桥只作回退。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const indexSource = readFileSync(join(here, '..', 'src/client/index.tsx'), 'utf8')
const probeSource = readFileSync(join(here, '..', 'src/client/session-probe.tsx'), 'utf8')

describe('会话桥:子会话不得覆盖主会话', () => {
  it('探针注册按 ctx.sessions.subagentAddress 判子会话(与上游模型选择器同源)', () => {
    expect(indexSource).toContain('subagent: isSubagentSession(ctx.sessions, sessionId)')
  })

  it('探针读取 subagent 判定并拒绝写入(shouldBindActiveSession)', () => {
    expect(probeSource).toContain('shouldBindActiveSession(sessionId, subagent)')
    expect(probeSource).toContain('subagent?: boolean')
  })
})

describe('模型菜单:按按钮所属对话解析会话', () => {
  it('优先 data-conversation-session,会话桥/localStorage 只作回退', () => {
    expect(indexSource).toContain("btn.closest('[data-conversation-session]')")
    expect(indexSource).toContain('sessionIdOfComposer(btn) ?? activeSessionId() ?? readCurrentSession()')
  })
})
