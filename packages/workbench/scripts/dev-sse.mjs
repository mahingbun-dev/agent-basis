#!/usr/bin/env node
/**
 * dev 用 SSE mock 服务启动器(38 号 T5;★T15/G2-D11 起为测试 fixture 与传输演示
 * 工具——客户端装载路径已切真源(access 登记的 /workbench/api/stream,数据面
 * tasks DomainEvents),mock 时间线不再驱动面板页,本服务仅供 fixture 用例与
 * 传输层演示)。
 *
 * 用法:pnpm --filter @eterna/workbench run dev:sse [-- --port 8788]
 * 环境变量 WORKBENCH_SSE_PORT / WORKBENCH_SSE_HOST 可覆写。
 *
 * 注:node ≥ 23.6 原生剥除 TS 类型后直接执行 .ts 导入(node 24 验证);
 * 数据/行为单一事实源在 src/(mock-source/dev-server),本启动器不含副本。
 */
import { createMockSseServer } from '../src/stream/dev-server.ts'

const args = new Set(process.argv.slice(2))
const argValue = (name) => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}

const port = Number(argValue('port') ?? process.env.WORKBENCH_SSE_PORT ?? 8788)
const host = argValue('host') ?? process.env.WORKBENCH_SSE_HOST ?? '127.0.0.1'

const server = createMockSseServer({ port, host })
const address = await server.start()

if (args.has('--quiet')) {
  // 测试/脚本模式:仅打印 URL(供管道消费)
  process.stdout.write(`${address.url}\n`)
} else {
  console.log('[workbench] SSE mock 服务(dev 用,38 号 T5)')
  console.log(`[workbench] 流端点: ${address.url}`)
  console.log('[workbench] 行为: 连接先推全量快照 → 增量 200ms 合批;Last-Event-ID 续传;15s keep-alive')
  console.log('[workbench] 时间线: +2s eval-run + log-appended(同窗合批)、+4s worker-updated(检查器上下文/成本推进)、+6s T-88b1 验收通过转 working;此后静默')
  console.log('[workbench] 接入: fixture/演示用直连缺省同端地址(客户端已切真源,G2-D11 无 mock 开关)')
}

const shutdown = () => {
  void server.stop().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
