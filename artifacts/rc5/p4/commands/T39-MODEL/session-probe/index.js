/** 浏览器验收用:经 sessionController 建一个真实空会话并打印 id,供 UI 直接打开。 */
export const name = 't39-session-probe'
export const inject = ['sessionController']
export function apply(ctx) {
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      try {
        const created = await ctx.sessionController.create({ cwd: '/tmp/t39-ui-home' })
        console.log(`T39_SESSION_ID ${created.sessionId}`)
      } catch (error) {
        console.log(`T39_SESSION_ID_ERROR ${JSON.stringify(String(error?.stack ?? error))}`)
      }
    }, 2500)
    return () => clearTimeout(timer)
  }, 't39-session-probe')
}
