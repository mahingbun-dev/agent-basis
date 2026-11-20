/** fixture:消费 greeting 服务(依赖解析冒烟用;领域服务经结构面访问,不进 Context 增强)。 */
export default {
  name: 'host',
  inject: { greeting: true } as never,
  apply(ctx: import('@core/cordis').Context): () => void {
    const service = (ctx as unknown as { greeting: { hello(): string } }).greeting
    ctx.provide('greetingEcho', { echo: () => service.hello() })
    return () => {}
  },
}
