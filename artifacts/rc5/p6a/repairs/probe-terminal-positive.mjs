// 探针：A(admin) 自己的 terminal/create 语义（记录上游原始错误/成功，判定固定报错是否与换血无关）
import { bootTokenFromContainer, bootstrapDshSession, defaultPaths, loadAccounts, login, rpc } from '../../../../scripts/rc5-test-client.mjs'

const args = defaultPaths()
const accounts = loadAccounts(args.accountsFile)
const dshCookie = await bootstrapDshSession(args.base, bootTokenFromContainer(args.container))
const authA = await login(args.base, accounts.admin.account, accounts.admin.password)
const cookieA = `${dshCookie}; ${authA.cookie}`
const created = await rpc(args.base, cookieA, 'session/create', { request: {} })
const sessionId = created.value?.sessionId
const env = await rpc(args.base, cookieA, 'terminal/environment', { agentId: sessionId })
console.log('A environment ok=', env.ok, 'cwd=', env.value?.cwd ?? env.error?.code)
const mk = await rpc(args.base, cookieA, 'terminal/create', { agentId: sessionId, request: { id: 'probe-a-1', cols: 80, rows: 24 } })
console.log('A create ok=', mk.ok, 'code=', mk.error?.code ?? '-', 'msg=', String(mk.error?.message ?? '').slice(0, 120))
const ls = await rpc(args.base, cookieA, 'terminal/list', { sessionId })
console.log('A list ok=', ls.ok, 'items=', Array.isArray(ls.value) ? ls.value.length : ls.error?.code)
