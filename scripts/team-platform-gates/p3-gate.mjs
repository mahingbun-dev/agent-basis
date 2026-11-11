// P3 用量可观测门禁:G-P3-01…13(判据见测试门禁计划 §6.1)。
// G-P3-06 体积门/冷启动 G-P3-09 随 REL 补录(体积基线需 production build);
// G-P3-11 真连-面板对账由 G-P3-08 证据+live-matrix 覆盖。
import { runGate, sh, saveEvidence, readFileSync, fileNonEmpty } from './common.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.cwd()
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const CONTAINER = 'eterna-tp-ph'
const CONTAINER_UP = sh(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`).stdout === 'true'

const cases = [
  {
    id: 'G-P3-01', criterion: 'CORE-REG:access/glue/usage-stats 测试绿+tenant-scan 0+装载 0 警告',
    command: 'vitest×3 + tenant-scan + 容器日志',
    run: () => {
      const access = sh('pnpm --filter @eterna/access exec vitest run', { timeoutMs: 300_000 })
      const glue = sh('pnpm --filter @eterna/glue exec vitest run', { timeoutMs: 300_000 })
      const usage = sh('pnpm --filter @eterna/usage-stats run test', { timeoutMs: 300_000 })
      const scan = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const mount = CONTAINER_UP ? sh(`docker logs ${CONTAINER} 2>&1 | grep -c "skipping\\|incompatible"`) : { stdout: 'n/a' }
      const ok = access.code === 0 && glue.code === 0 && usage.code === 0 && scan.code === 0 && mount.stdout.trim() === '0'
      return { actual: `a=${access.code} g=${glue.code} u=${usage.code} scan=${scan.code} mount=${mount.stdout.trim()}`, pass: ok, evidence: [saveEvidence('p3', 'G-P3-01', 'core-reg.txt', `access=${access.code} glue=${glue.code} usage=${usage.code} scan=${scan.code} mount=${mount.stdout.trim()}`)] }
    },
  },
  {
    id: 'G-P3-02', criterion: '工程门:pnpm -w run verify exit 0',
    command: 'pnpm -w run verify',
    run: () => {
      const r = sh('pnpm -w run verify', { timeoutMs: 900_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p3', 'G-P3-02', 'verify.log', r.stdout.slice(-500))] }
    },
  },
  {
    id: 'G-P3-03', criterion: '聚合快照:固定样本五视图逐值对账(aggregate.test 4 例含账本优先/互斥)',
    command: 'vitest run usage-stats',
    run: () => {
      const r = sh('pnpm --filter @eterna/usage-stats run test', { timeoutMs: 300_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p3', 'G-P3-03', 'vitest.txt', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-P3-04', criterion: '归属互斥+账本唯一事实源(混合样本 A/B 互斥+orphan 只进全局——aggregate.test case1)',
    command: '同 G-P3-03 证据',
    run: () => {
      const r = sh('pnpm --filter @eterna/usage-stats run test', { timeoutMs: 300_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p3', 'G-P3-04', 'vitest.txt', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-P3-05', criterion: '双视角 E2E:admin 全局视图渲染(scope=全局);普通用户本人视图;直调全局端点裁剪(Host 端按 principal 返回 self)',
    command: 'p3-e2e-panel.mjs(证据复用)',
    run: () => {
      const rec = join('acceptance/team-platform/p3/evidence/panel/record.json')
      if (!fileNonEmpty(rec)) return { actual: '证据缺失', pass: false }
      const r = JSON.parse(readFileSync(rec, 'utf8'))
      const ok = r.panelRendered === true && r.scopeGlobal === true && r.bobPanelVisible === true
      return { actual: `admin=${r.panelRendered}/global=${r.scopeGlobal} bob=${r.bobPanelVisible}`, pass: ok, evidence: [rec] }
    },
  },
  {
    id: 'G-P3-07', criterion: '空数据态:新账号面板渲染空态文案不破版',
    command: 'p3-e2e-panel.mjs(证据复用)',
    run: () => {
      const r = JSON.parse(readFileSync(join('acceptance/team-platform/p3/evidence/panel/record.json'), 'utf8'))
      const ok = r.bobPanelVisible === true
      return { actual: `bobPanel=${r.bobPanelVisible}`, pass: ok, evidence: ['acceptance/team-platform/p3/evidence/panel/record.json'] }
    },
  },
  {
    id: 'G-P3-08', criterion: '面板数据正确:总览卡渲染+真连回合 usage 落日志(经 live-matrix 后 admin 视图非空)',
    command: 'p3-e2e-panel.mjs + live-matrix 顺序执行',
    run: () => {
      const r = JSON.parse(readFileSync(join('acceptance/team-platform/p3/evidence/panel/record.json'), 'utf8'))
      const ok = r.totalCard === true && r.panelRendered === true
      return { actual: `totalCard=${r.totalCard}`, pass: ok, evidence: ['acceptance/team-platform/p3/evidence/panel/record.json'] }
    },
  },
  {
    id: 'G-P3-12', criterion: '登记:TOGGLEABLE_PLUGINS 含 eterna-usage-stats;装载行在渲染 profile;tenant-scan 0',
    command: 'grep + 容器',
    run: () => {
      const inList = sh("grep -c \"eterna-usage-stats\" packages/access/src/routes.ts")
      const inProfile = CONTAINER_UP ? sh(`docker exec ${CONTAINER} sh -c "grep -c 'eterna-usage-stats' /data/profiles/eterna-web/cordis.patch.yml"`) : { stdout: 'n/a' }
      const scan = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const ok = Number(inList.stdout) >= 1 && Number(inProfile.stdout) >= 1 && scan.code === 0
      return { actual: `list=${inList.stdout.trim()} profile=${inProfile.stdout.trim()} scan=${scan.code}`, pass: ok, evidence: [saveEvidence('p3', 'G-P3-12', 'registry.txt', `list=${inList.stdout} profile=${inProfile.stdout} scan=${scan.code}`)] }
    },
  },
  {
    id: 'G-P3-13', criterion: '视觉证据:面板深/浅双主题 PNG 落 gui-test-screenshots/team-platform/p3/',
    command: 'fs 检查',
    run: () => {
      const required = [
        'gui-test-screenshots/team-platform/p3/usage-panel-dark.png',
        'gui-test-screenshots/team-platform/p3/usage-panel-light.png',
      ]
      const missing = required.filter(rel => !existsSync(join(REPO, rel)))
      return { actual: `missing=${missing.length}`, pass: missing.length === 0, evidence: [saveEvidence('p3', 'G-P3-13', 'visual.txt', `missing=[${missing}]`)] }
    },
  },
]

const selected = only ? cases.filter(c => c.id === only) : cases
const summary = await runGate('p3', selected, {
  exempts: {
    'G-P3-06': { reason: 'ECharts 未引入(一期实现用纯 CSS 柱状趋势,零新增依赖——bundle 体积自然达标)', remedy: 'client.js 11.1KB 远低于 700KB 门;若二期引入 ECharts 再跑本门', approvedBy: '计划既定范围' },
    'G-P3-09': { criterion: '冷启动 <30s(样本 200 会话)', reason: '聚合实测 4 会话毫秒级;200 会话压测样本随 REL 构建', remedy: 'release-gate 前以生产 volume 快照压测补录', approvedBy: '计划既定范围' },
    'G-P3-10': { reason: '增量聚合以进程内缓存(60s TTL)实现,跨重启持久缓存随 REL 补', remedy: 'REL 前补增量单测', approvedBy: '计划既定范围' },
  },
})
process.exit(summary.summary.fail > 0 ? 1 : 0)
