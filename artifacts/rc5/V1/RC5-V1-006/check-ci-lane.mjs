// V1-006 (static half): v1 CI lane is an independent job and does not install a global dsh.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const root = '/Users/sunny/code/agent-basis-rc5'
const require = createRequire(`${root}/core/runtime/package.json`)
const { parse } = require('yaml')
const ci = parse(readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8'))
const job = ci.jobs?.['v1-line']
let fail = 0
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) fail += 1 }
check('v1-line job exists', job !== undefined, job === undefined ? 'missing' : 'ci.yml jobs.v1-line')
check('v1-line has no job-level needs (independent)', job?.needs === undefined, JSON.stringify(job?.needs ?? null))
check('v1-line is not schedule-triggered', String(job?.if ?? '').includes("github.event_name != 'schedule'"), String(job?.if ?? ''))
const steps = job?.steps ?? []
const text = JSON.stringify(steps)
check('runs cordis declarations + typecheck + test', text.includes('@core/cordis') && text.includes('declarations') && text.includes('typecheck') && text.includes('test'), `${steps.length} steps`)
check('runs runtime typecheck + test', text.includes('@core/runtime'), 'steps')
check('runs six @basis package typecheck/test loop', text.includes('system-prompt session tools llm approval-cli agent-loop'), 'steps')
check('runs basis.yml six-plugin chat smoke', text.includes('basis.mjs chat --bundle basis.yml'), 'steps')
check('runs the V1-007 dsh import guard', text.includes('@deepseek-ai/dsh') && text.includes('v1 源不依赖产品线'), 'steps')
check('does not install a global dsh', !/npm\s+i\s+-g[^\n]*@deepseek-ai\/dsh/.test(text), 'no npm i -g dsh step')
check('uses frozen lockfile install', text.includes('pnpm install --frozen-lockfile'), 'steps')
console.log('scope: v1-line trigger paths=', text.match(/changed[^\n]*/)?.[0]?.slice(0, 160) ?? '(not printed)')
console.log('NOTE: CI 实际 job 运行状态不在本地 E0 可验证面;此处只核对车道定义。')
console.log(`SUMMARY failures=${fail}`)
process.exit(fail === 0 ? 0 : 1)
