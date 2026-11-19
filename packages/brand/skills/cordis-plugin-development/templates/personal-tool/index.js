// EternaAgent 个人工具插件最小模板(T6 装载器契约;参考 references/personal-tools.md)。
// 安装:把本目录(两个文件)复制为当前用户工作区 plugins/<目录名>/,然后调用
// install_personal_plugin(dir=目录名)。工具名会自动加 user_<账号>_ 前缀。

export function apply(ctx) {
  ctx.tools.register({
    name: 'hello', // 装载后为 user_<账号>_hello;须匹配 ^[\w][\w.-]{0,63}$
    description: 'Say hello to someone.',
    parameters: {
      who: { type: 'string', required: true, description: 'Who to greet.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute(args) {
      return `Hello, ${args.who}!`
    },
  })
}
