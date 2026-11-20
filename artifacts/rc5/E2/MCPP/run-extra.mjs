#!/usr/bin/env node
/**
 * E2 · MCPP 扩展用例 runner（011/016/017/018 的容器实跑）。
 *
 * 共享一次 sessions()（登录限速 5/min，四条用例合计 12 次登录会被限速；
 * 同一进程内缓存 cookie 避免假红）。
 *
 * 用法：
 *   node artifacts/rc5/E2/MCPP/run-extra.mjs            # 全跑
 *   node artifacts/rc5/E2/MCPP/run-extra.mjs --only 011,016
 *
 * 前提（lane 环境，见 artifacts/rc5/E2/_setup/compose.e2suite.override.yml）：
 *   - ETERNA_MCP_PERSONAL_CATALOG 含 echo + hung；
 *   - ETERNA_MCP_PERSONAL_HTTP_HOSTS 含 a.example,*.suffix.test,host.docker.internal；
 *   - fake-llm-server.mjs 在 4599（017/018）。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANE, sessions } from '../_lib/env.mjs'
import { run as case011 } from './mcpp-011.mjs'
import { run as case016 } from './mcpp-016.mjs'
import { run as case017 } from './mcpp-017.mjs'
import { run as case018 } from './mcpp-018.mjs'
import { run as case024 } from './mcpp-024.mjs'

const modules = { '011': case011, '016': case016, '017': case017, '018': case018, '024': case024 }
const only = (process.argv.find(argument => argument.startsWith('--only=')) ?? '--only=011,016,017,018,024')
  .slice('--only='.length).split(',').map(item => item.trim()).filter(Boolean)
const unknown = only.filter(id => modules[id] === undefined)
if (unknown.length > 0) {
  console.error(`[MCPP-extra] 未知用例: ${unknown.join(',')}`)
  process.exit(2)
}

const s = await sessions()
const rows = []
for (const id of only) {
  console.log(`[MCPP-extra] 开始 RC5-MCPP-${id}`)
  try {
    rows.push(await modules[id](s))
  } catch (error) {
    rows.push({ id: `RC5-MCPP-${id}`, status: 'FAIL', title: '执行异常', detail: String(error?.message ?? error).slice(0, 300) })
    console.error(`[MCPP-extra] RC5-MCPP-${id} 异常: ${String(error?.stack ?? error).slice(0, 800)}`)
  }
}
for (const row of rows) console.log(`[MCPP-extra] ${row.id} ${row.status} :: ${row.detail}`)
writeFileSync(join(LANE.evidenceRoot, 'MCPP', 'extra-results.json'), JSON.stringify(rows, null, 1))
const counts = rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc }, {})
console.log(`[MCPP-extra] PASS=${counts.PASS ?? 0} FAIL=${counts.FAIL ?? 0} SKIP=${counts.SKIP ?? 0} NOTRUN=${counts.NOTRUN ?? 0}`)
process.exit((counts.FAIL ?? 0) === 0 ? 0 : 1)