/**
 * T39 命令面活体探针(真 boot eterna-web profile):
 *  - 经 sessionController.create 建真实会话(与 Web UI 同路径,预设在此挂载);
 *  - 读 ctx.commands.list(agent)(客户端 / 菜单同源 RPC);
 *  - 断言 compact 在场、definitionId=上游首方身份、命令名无重复;
 *  - 经 ctx.commands.execute 执行 /compact(空会话 → 当前 compact 实现返回 null);
 *  - 打印 /model 在 Host 命令目录中的缺席事实(模型切换是客户端 commandUi 贡献)。
 */
export const name = 't39-command-probe'

export const inject = ['sessionController', 'agents', 'commands']

export function apply(ctx) {
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      try {
        const created = await ctx.sessionController.create({ cwd: '/tmp/t39-command-probe-home' })
        const agent = ctx.agents.get(created.sessionId)
        if (agent === undefined) throw new Error(`agent not live after create: ${created.sessionId}`)
        const descriptors = ctx.commands.list(agent)
        const presets = ctx.get('agentPresets')
        const presetRoster = presets === undefined ? null : (await presets.list()).map((row) => ({ id: row.id, order: row.order, broken: row.broken }))
        const names = descriptors.map((descriptor) => descriptor.name)
        const compact = descriptors.find((descriptor) => descriptor.name === 'compact')
        const controller = new AbortController()
        const execution = await ctx.commands.execute(agent, '/compact', [], controller.signal)
        const modelExecution = await ctx.commands.execute(agent, '/model', [], controller.signal)
        const unknownExecution = await ctx.commands.execute(agent, '/definitely-not-a-command', [], controller.signal)
        const events = agent.session.snapshotEvents()
        const eventTypes = events.map((event) => event.type)
        const commandEvents = events
          .filter((event) => event.type === 'command/run' || event.type === 'command/done')
          .map((event) => ({ type: event.type, data: event.data }))
        const userMessages = events.filter((event) => event.type === 'user/message')
        console.log(`T39_COMMAND_PROBE ${JSON.stringify({
          ok: true,
          sessionId: created.sessionId,
          agentPreset: created.agentPreset,
          presetRoster,
          activePreset: (() => { const presets = ctx.get('agentPresets'); return presets === undefined ? null : presets.presetForSession(agent.session) })(),
          commandCount: descriptors.length,
          names,
          duplicateNames: names.filter((value, index) => names.indexOf(value) !== index),
          compact: compact === undefined ? null : { name: compact.name, definitionId: compact.definitionId, description: compact.description },
          builtinCompactIdentity: compact?.definitionId === '@deepseek-ai/dsh-command-compact',
          compactExecution: execution === undefined ? null : {
            commandId: execution.commandId,
            result: execution.result,
          },
          modelInHostCatalog: descriptors.some((descriptor) => descriptor.name === 'model'),
          modelExecutionResult: modelExecution === undefined ? 'unresolved(客户端命令:不在 Host 目录)' : modelExecution.result,
          unknownExecutionResult: unknownExecution === undefined ? 'unresolved(预期)' : unknownExecution.result,
          commandEventTypes: eventTypes.filter((type) => type.startsWith('command/')),
          commandEventCount: commandEvents.length,
          commandEvents,
          userMessageCount: userMessages.length,
          userMessageMentionsCompact: userMessages.some((event) => JSON.stringify(event.data).includes('/compact')),
        })}`)
      } catch (error) {
        console.log(`T39_COMMAND_PROBE_ERROR ${JSON.stringify(String(error?.stack ?? error))}`)
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, 't39-command-probe')
}
