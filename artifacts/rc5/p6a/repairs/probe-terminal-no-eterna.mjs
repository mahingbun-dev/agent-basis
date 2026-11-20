// 探针：只有 dsh-auth、无 eterna_session 的 /api/terminal/* 请求必须 401（fail-closed）
import { bootTokenFromContainer, bootstrapDshSession, defaultPaths, loadAccounts, login, request, rpc } from '../../../../scripts/rc5-test-client.mjs'

const args = defaultPaths()
const accounts = loadAccounts(args.accountsFile)
const dshCookie = await bootstrapDshSession(args.base, bootTokenFromContainer(args.container))
const authA = await login(args.base, accounts.admin.account, accounts.admin.password)
const full = await rpc(args.base, `${dshCookie}; ${authA.cookie}`, 'session/create', { request: {} })
const sessionId = full.value?.sessionId
// 只有 dsh-auth（浏览器已连、但 eterna 会话缺席/过期）
const bare = await rpc(args.base, dshCookie, 'terminal/environment', { agentId: sessionId })
console.log('no-eterna terminal/environment status=', bare.status, 'code=', bare.error?.code ?? bare.text?.slice(0, 40))
const bareList = await request(new URL('/api/terminal/list', args.base), {
  method: 'POST',
  cookie: dshCookie,
  body: { type: 'client-request', rpcId: 'probe', method: 'terminal/list', payload: { args: { sessionId } } },
})
console.log('no-eterna terminal/list http status=', bareList.status, 'body=', bareList.text.slice(0, 40))
