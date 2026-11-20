#!/usr/bin/env node
/**
 * E2 · RC5-MCPP-011：host 白名单（容器实跑，P1）。
 *
 * 前提：lane 以 ETERNA_MCP_PERSONAL_HTTP_HOSTS=a.example,*.suffix.test,host.docker.internal 启动。
 * 判定：
 *   - b.example            → upsert 被拒（文案含「允许列表」），且 list 不新增；
 *   - a.example            → 接受（精确 host）；
 *   - svc.suffix.test      → 接受（*.suffix 通配）；
 *   - suffix.test          → 被拒（通配只匹配子域，不是后缀自身）；
 *   - a.example:8443        → 接受（host:port 精确项按默认端口语义验证：8443 未列出应拒）。
 * 收尾删除已创建的行，list 回到起点。
 *
 * 用法：node artifacts/rc5/E2/MCPP/run-extra.mjs --only 011
 */
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { call, LANE } from '../_lib/env.mjs'

const EXPECTED_HOSTS = ['a.example', '*.suffix.test', 'host.docker.internal', 'b.example:8443']

export async function run(s) {
  const c = new Case('MCPP', 'RC5-MCPP-011')
  const cookie = s.userB.cookie

  const catalog = await call(cookie, 'mcp-personal/catalog')
  const hosts = catalog.value?.hostWhitelist ?? []
  c.cmd('POST /api/mcp-personal/catalog（B，读取生效白名单）', catalog.status, `hostWhitelist=${JSON.stringify(hosts)}`)
  const preconditions = EXPECTED_HOSTS.every(host => hosts.includes(host))

  const attempts = [
    { name: 'wh-b', url: 'https://b.example/mcp', expect: 'deny' },
    { name: 'wh-a', url: 'https://a.example/mcp', expect: 'allow' },
    { name: 'wh-wild', url: 'https://svc.suffix.test/mcp', expect: 'allow' },
    { name: 'wh-apex', url: 'https://suffix.test/mcp', expect: 'deny' },
    { name: 'wh-anyport', url: 'https://a.example:8443/mcp', expect: 'allow' },
    { name: 'wh-port-ok', url: 'https://b.example:8443/mcp', expect: 'allow' },
    { name: 'wh-port-bad', url: 'https://b.example:9443/mcp', expect: 'deny' },
  ]
  const results = []
  const created = []
  for (const attempt of attempts) {
    const upsert = await call(cookie, 'mcp-personal/upsert', {
      request: { name: attempt.name, transport: 'streamable-http', url: attempt.url },
    })
    const allowed = upsert.ok === true
    const deniedMessage = String(upsert.error?.message ?? upsert.value?.message ?? '')
    c.cmd(`POST /api/mcp-personal/upsert {name:${attempt.name},url:${attempt.url}}（期望 ${attempt.expect}）`, upsert.status,
      `ok=${allowed} code=${upsert.error?.code ?? '-'} serverName=${upsert.value?.item?.serverName ?? '-'} msg=${shape(deniedMessage, 160)}`)
    results.push({ ...attempt, allowed, deniedMessage })
    if (allowed) created.push(upsert.value?.item?.id)
    if (attempt.expect === 'deny' && allowed) {
      await call(cookie, 'mcp-personal/delete', { request: { id: upsert.value?.item?.id } })
    }
  }

  const listed = await call(cookie, 'mcp-personal/list')
  const names = (listed.value?.items ?? []).map(item => item.name)
  const leakedDenied = attempts.filter(row => row.expect === 'deny').some(row => names.includes(row.name))
  c.cmd('POST /api/mcp-personal/list（白名单尝试后）', listed.status, `items=${JSON.stringify(names)}`)

  for (const id of created) {
    const deleted = await call(cookie, 'mcp-personal/delete', { request: { id } })
    c.cmd('POST /api/mcp-personal/delete（清理白名单用例行）', deleted.status, `ok=${deleted.ok}`)
  }

  const deniedOk = results.filter(row => row.expect === 'deny').every(row => row.allowed === false && /允许列表/.test(row.deniedMessage))
  const allowedOk = results.filter(row => row.expect === 'allow').every(row => row.allowed === true)
  c.assert('前置：lane 白名单已生效', preconditions, JSON.stringify(hosts))
  c.assert('b.example 被拒且文案指向允许列表', deniedOk, shape(results.filter(row => row.expect === 'deny')))
  c.assert('a.example 与 *.suffix.test 子域被接受', allowedOk)
  c.assert('后缀自身（suffix.test）不被 *.suffix.test 匹配', results.find(row => row.name === 'wh-apex')?.allowed === false)
  c.assert('精确 host 不限端口（a.example:8443 放行）', results.find(row => row.name === 'wh-anyport')?.allowed === true)
  c.assert('host:port 精确项（b.example:8443 放行）', results.find(row => row.name === 'wh-port-ok')?.allowed === true)
  c.assert('未列端口（b.example:9443）被拒', results.find(row => row.name === 'wh-port-bad')?.allowed === false)
  c.assert('被拒行未落库', leakedDenied === false, JSON.stringify(names))

  const pass = preconditions && deniedOk && allowedOk && leakedDenied === false
    && results.find(row => row.name === 'wh-apex')?.allowed === false
    && results.find(row => row.name === 'wh-anyport')?.allowed === true
    && results.find(row => row.name === 'wh-port-ok')?.allowed === true
    && results.find(row => row.name === 'wh-port-bad')?.allowed === false
  const row = c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: 'personalHttpHosts 白名单：精确 host / *.suffix / 非子域 / 端口',
    expected: 'a.example 与 *.suffix.test 的子域放行；b.example、suffix.test、未列端口被拒；被拒行不落库',
    actual: results.map(item => `${item.url}=>${item.allowed ? 'ALLOW' : 'DENY'}`).join('；'),
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      '本用例与 MCPP-010（白名单为空=全放行）互证：同一产品代码在两种配置下行为相反',
      '容器环境变量：ETERNA_MCP_PERSONAL_HTTP_HOSTS=a.example,*.suffix.test,host.docker.internal',
    ],
    artifacts: ['cmd.log'],
  })
  return row
}