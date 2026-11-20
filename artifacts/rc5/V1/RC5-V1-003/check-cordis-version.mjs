// V1-003: core/cordis is re-vendored from @deepseek-ai/cordis 4.1.0 and NOTICE provenance is present.
import { readFileSync, existsSync } from 'node:fs'
const root = '/Users/sunny/code/agent-basis-rc5'
let fail = 0
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) fail += 1 }
const pkg = JSON.parse(readFileSync(`${root}/core/cordis/package.json`, 'utf8'))
check('local vendor version is 4.1.0 line', /^4\.1\.0(?:-basis\.\d+)?$/.test(pkg.version), pkg.version)
check('package description names upstream 4.1.0', pkg.description.includes('@deepseek-ai/cordis 4.1.0'), pkg.description.slice(0, 100))
const readme = readFileSync(`${root}/core/cordis/README.md`, 'utf8')
check('README NOTICE section present', readme.includes('## NOTICE(vendor 出处与许可)'), 'README.md:5')
check('NOTICE names upstream @deepseek-ai/cordis 4.1.0', readme.includes('`@deepseek-ai/cordis` **4.1.0**'), 'README.md:7')
check('NOTICE records upstream tag dsh-v0.2.2-rc.5', readme.includes('dsh-v0.2.2-rc.5'), 'README.md:7')
check('LICENSE preserved', existsSync(`${root}/core/cordis/LICENSE`), 'core/cordis/LICENSE')
const src = readFileSync(`${root}/core/cordis/src/logger.ts`, 'utf8')
check('vendor LoggerLevel is 4.1.0 semantics', /ERROR:\s*0[\s\S]*WARN:\s*1[\s\S]*INFO:\s*2[\s\S]*DEBUG:\s*3/.test(src), 'src/logger.ts LoggerLevel')
console.log(`SUMMARY failures=${fail}`)
process.exit(fail === 0 ? 0 : 1)
