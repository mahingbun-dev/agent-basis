/** fixture:直接 provide 一个 agents 注册表(stub runner,CLI 编排冒烟用)。 */
export default {
  name: 'stub-agent',
  apply(ctx: import('@core/cordis').Context): () => void {
    return ctx.provide('agents', {
      register: () => () => {},
      resolve: (name?: string) => ({
        run: async (input: string) => ({
          turn: 1,
          steps: 1,
          output: `echo(${name ?? 'default'}):${input}`,
          toolCalls: [],
        }),
      }),
      defaultName: () => 'default',
      setDefault: () => {},
    })
  },
}
