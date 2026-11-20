// T30 机制探针(非产品代码):证明 access 在兄弟 ctx 上注册的 connection/request
// 监听器会被 client-connection 子上下文发起的 waterfall 收到,且 prepend 先生效。
// 依赖路径直接取 packages/access 的解析结果(证据目录不在包 node_modules 继承链上)。
import { Context } from 'file:///Users/sunny/code/agent-basis-rc5/node_modules/.pnpm/@deepseek-ai+cordis@4.1.0_@deepseek-ai+cordis-plugin-include@1.1.0_@deepseek-ai+cordis-plugin-loader@1.1.0/node_modules/@deepseek-ai/cordis/lib/index.js'
const root = new Context()
const access = root.extend({ name: 'access' })
const webVendor = root.extend({ name: 'client-connection' })
const order = []
access.on('connection/request', async (req, res, next) => {
  order.push('access:' + req.url)
  return next()
}, { prepend: true })
webVendor.on('connection/request', async (req, res, next) => {
  order.push('vendor')
  return next()
})
const result = await webVendor.waterfall('connection/request', { url: '/api/x' }, {}, async () => { order.push('inner') })
console.log(JSON.stringify({ order, result }))
