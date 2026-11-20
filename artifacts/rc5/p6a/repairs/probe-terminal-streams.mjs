// 辅助探针（TERM-005 补充证据）：/api/remote.mux 真实 WS 打开帧。
// 1) A 自己 terminal/attach → 非授权拒绝(上游无活终端 = terminal/unavailable) 证明守卫未破坏 this.ctx；
// 2) B 用 A 的 session 打开 attach/retain/watch → 必须 remote-access/denied。
import { bootTokenFromContainer, bootstrapDshSession, defaultPaths, loadAccounts, login, rpc } from '../../../../scripts/rc5-test-client.mjs'
import { openMuxSocket } from '../../E2/_lib/ws.mjs'

const args = defaultPaths()
const accounts = loadAccounts(args.accountsFile)
const dshCookie = await bootstrapDshSession(args.base, bootTokenFromContainer(args.container))
const authA = await login(args.base, accounts.admin.account, accounts.admin.password)
const authB = await login(args.base, accounts.user_b.account, accounts.user_b.password)
const cookieA = `${dshCookie}; ${authA.cookie}`
const cookieB = `${dshCookie}; ${authB.cookie}`
const created = await rpc(args.base, cookieA, 'session/create', { request: {} })
const victim = created.value?.sessionId

async function probe(cookie, endpoint, payload, label) {
  const streamId = `probe-${Math.random().toString(36).slice(2, 10)}`
  const sock = await openMuxSocket({ host: '127.0.0.1', port: 3108, path: '/api/remote.mux', cookie })
  try {
    sock.send({ type: 'open', streamId, endpoint, payload: { args: payload } })
    try {
      await sock.waitMessage(m => m.streamId === streamId && ['error', 'end', 'item'].includes(m.type), 10_000)
    } catch { /* 超时也收集已有帧 */ }
    await new Promise(r => setTimeout(r, 300))
    const frame = sock.messages.find(m => m.streamId === streamId && m.type === 'error')
      ?? sock.messages.find(m => m.streamId === streamId && (m.type === 'item' || m.type === 'end'))
    console.log(label, '=>', frame?.type ?? 'timeout', frame?.error?.code ?? '', String(frame?.error?.message ?? '').slice(0, 100))
    return frame
  } finally { sock.close() }
}

await probe(cookieA, 'terminal/attach', { agentId: victim, id: 'probe-t1' }, 'A attach own (无活终端应为 terminal/unavailable)')
await probe(cookieB, 'terminal/attach', { agentId: victim, id: 'probe-t1' }, 'B attach A.session')
await probe(cookieB, 'terminal/retain', { sessionId: victim, id: 'probe-t1' }, 'B retain A.session')
await probe(cookieB, 'terminal/watch', { sessionId: victim }, 'B watch A.session')
