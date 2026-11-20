/** fixture:provide 一个 greeting 服务(装载/回卷冒烟用)。 */
const state = { disposed: false }
export default {
  name: 'greeter',
  apply(ctx: import('@core/cordis').Context): () => void {
    const dispose = ctx.provide('greeting', { hello: () => 'hi', isDisposed: () => state.disposed })
    return () => {
      state.disposed = true
      dispose()
    }
  },
}
