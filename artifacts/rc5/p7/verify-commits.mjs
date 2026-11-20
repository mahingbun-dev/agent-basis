// T52 提交后核验：9 个分组提交的文件面/前缀/关键产品文件入库/状态卫生。
// 只读 git，不改文件。
import { execSync } from 'node:child_process'

const root = '/Users/sunny/code/agent-basis-rc5'
const git = (cmd) => execSync(`git -c core.quotepath=false ${cmd}`, { cwd: root, encoding: 'utf8' })
const fails = []
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`)
  if (!cond) fails.push(name)
}

const groups = [
  ['67aac03', 'rc5: P2 profile/preset/bundle', [/^docker\/profile\/(cordis\.patch\.yml\.template|cordis\.super\.patch\.yml\.template|package\.json)$/, /^profiles\//, /^scripts\/verify-eterna-(web|super)\.mjs$/, /^packages\/prompt-studio\//, /^tools\/packctl\/(src\/prompt\.ts|tests\/prompt\.spec\.ts)$/, /^docs\/dev\/ps-v2-registry-ledger\.md$/]],
  ['6930e92', 'rc5: P2 迁移脚本', [/^docker\/profile\/(migrate-|package\.acp\.json|cordis\.acp\.patch\.yml\.template)/, /^docker\/entrypoint\.sh$/, /^scripts\/profile-upgrade-check/]],
  ['7daf9c5', 'rc5: P3 v1 线', [/^core\//, /^\.github\/workflows\/ci\.yml$/, /^market\//, /^packs\//, /^packages\/brand\/skills\//]],
  ['5b91c5f', 'rc5: P4 客户端', [/^packages\/(access|attachments|brand|compaction|llm-doctor|memory|panel|usage-stats|workbench)\/scripts\/build-client\.mjs$/, /^packages\/brand\/src\/client\//, /^packages\/brand\/tests\//]],
  ['e5231cb', 'rc5: access 网关角色门', [/^packages\/access\//, /^pnpm-lock\.yaml$/]],
  ['e71e33d', 'rc5: tasks 后台适配', [/^packages\/tasks\//, /^packages\/llm-openai\//, /^packages\/compaction\/(src\/command-plugin\.ts|tests\/)/]],
  ['ccd9380', 'rc5: P5 镜像', [/^Dockerfile$/, /^docker-compose(\.super)?\.yml$/, /^deploy\/(backup-data\.sh|init-data-dirs\.sh|pre-restart-check\.sh|env\.production\.example)$/]],
  ['a72d187', 'rc5: 验证脚本/夹具/证据包', [/^scripts\//, /^tests\/fixtures\//, /^artifacts\/rc5\//, /^packages\/browser-relay\/smoke\/gate-setup\.mjs$/]],
  ['a89a73a', 'docs(rc5): 54 完整 workflow', [/^deploy\/README\.md$/, /^docs\/design\/53-/, /^docs\/design\/54-/, /^docs\/dev\/TODO\.md$/, /^docs\/docker-deploy\.md$/]],
]

for (const [sha, subject, allows] of groups) {
  const info = git(`show -s --format=%s ${sha}`).trim()
  ok(`COMMIT_${sha}_SUBJECT`, info.startsWith(subject), info)
  const files = git(`show --name-only --format= ${sha}`).split('\n').filter(Boolean)
  const out = files.filter((f) => !allows.some((re) => re.test(f)))
  ok(`COMMIT_${sha}_SCOPE`, files.length > 0 && out.length === 0, out.slice(0, 5).join(','))
}

const keys = [
  'packages/access/src/mcp-personal.ts',
  'packages/access/src/mux.ts',
  'packages/tasks/src/executor/background.ts',
  'core/cordis/src/fiber.ts',
  'docker/profile/migrate-mcp-servers.mjs',
  'Dockerfile',
  'artifacts/rc5/acceptance-matrix.md',
  'artifacts/rc5/p7/t52-recheck.log',
  'docs/design/54-rc.5开发与测试验收完整workflow.md',
]
const tracked = git('ls-files').split('\n')
const missing = keys.filter((k) => !tracked.includes(k))
ok('PRODUCT_FILES_TRACKED', missing.length === 0, missing.join(','))

const status = git('status --porcelain -uall').split('\n').filter(Boolean)
const forbidden = status.filter((l) => /(^|\/)\.secrets(\/|$)|(^|\/)\.env($|\.)|users\.db|node_modules\//.test(l))
ok('STATUS_NO_FORBIDDEN', forbidden.length === 0, forbidden.join(','))
const liveSoak = status.filter((l) => /artifacts\/rc5\/p5\/testbed\/soak\/.*(jsonl|log)$/.test(l))
console.log(`INFO status_entries=${status.length} live_soak_appends=${liveSoak.length}`)
for (const line of status) console.log(`STATUS ${line}`)

console.log(`RESULT=${fails.length === 0 ? 'ALL_COMMITS_SCOPED' : 'FAIL:' + fails.join(',')}`)
process.exit(fails.length === 0 ? 0 : 1)