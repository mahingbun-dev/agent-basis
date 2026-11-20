export const name = 'team-default-probe'

export const inject = ['agentTeams', 'agentLoop', 'agentDefaultModel', 'loader']

/**
 * 真 boot 探针：
 *  - TEAM_DEFAULT_PROBE：新建会话后读 ctx.agentTeams.isEnabled()（默认关的真值）；
 *  - PROFILE_CONFIG_PROBE：读 Loader 活体 entry 的 effectiveConfig（Zod 解析后的
 *    运行时配置），验证 office/terminal/agent-team 的 profile 设定真的生效。
 */
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      try {
        const loader = ctx.get('loader')
        const entries = loader === undefined ? [] : [...loader.entries()]
        const effective = (id) => {
          const entry = entries.find((candidate) => candidate.options.id === id
            || candidate.id === id || String(candidate.id).endsWith(`:${id}`))
          return entry?.fiber?.effectiveConfig
        }
        console.log(`PROFILE_CONFIG_PROBE ${JSON.stringify({
          skillOffice: effective('skill-office'),
          officeKit: effective('office-kit'),
          terminalPanel: effective('optional-terminal-panel'),
          agentTeam: effective('agent-team'),
        })}`)
        const selection = ctx.agentDefaultModel.currentSelection()
        const id = `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const agent = await ctx.agentLoop.create(id, {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        }, { cwd: '/tmp/team-probe-home' })
        const enabled = ctx.agentTeams.isEnabled(agent)
        const types = agent.session.snapshotEvents().map((event) => event.type)
        console.log(`TEAM_DEFAULT_PROBE ${JSON.stringify({
          sessionId: agent.id,
          isEnabled: enabled,
          teamModeEventCount: types.filter((type) => type === 'team/mode').length,
          selection,
        })}`)
      } catch (error) {
        console.log(`TEAM_DEFAULT_PROBE_ERROR ${JSON.stringify(String(error?.stack ?? error))}`)
      }
    }, 2500)
    return () => clearTimeout(timer)
  }, 'team-default-probe')
}
