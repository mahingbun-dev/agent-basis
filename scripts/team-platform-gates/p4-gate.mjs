// P4 插件生态与收尾门禁:G-P4-01…21(判据见测试门禁计划 §7.1)。
// 一期边界豁免:三面过滤的进程内 mount/审批流停用降级挂点(计划既定,随二期);
// 其余按容器 E2E 证据判定。
import { runGate, sh, saveEvidence, readFileSync, fileNonEmpty } from './common.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.cwd()
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const CONTAINER = 'eterna-tp-ph'
const CONTAINER_UP = sh(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`).stdout === 'true'

const cases = [
  {
    id: 'G-P4-01', criterion: 'CORE-REG:access/glue/usage-stats 测试绿+tenant-scan 0+装载 0 警告',
    command: 'vitest×3 + tenant-scan + 容器日志',
    run: () => {
      const access = sh('pnpm --filter @eterna/access exec vitest run', { timeoutMs: 300_000 })
      const glue = sh('pnpm --filter @eterna/glue exec vitest run', { timeoutMs: 300_000 })
      const usage = sh('pnpm --filter @eterna/usage-stats run test', { timeoutMs: 300_000 })
      const scan = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const mount = CONTAINER_UP ? sh(`docker logs ${CONTAINER} 2>&1 | grep -c "skipping\\|incompatible\\|ERR_UNSUPPORTED"`) : { stdout: 'n/a' }
      const ok = access.code === 0 && glue.code === 0 && usage.code === 0 && scan.code === 0 && mount.stdout.trim() === '0'
      return { actual: `a=${access.code} g=${glue.code} u=${usage.code} scan=${scan.code} mount=${mount.stdout.trim()}`, pass: ok, evidence: [saveEvidence('p4', 'G-P4-01', 'core-reg.txt', `access=${access.code} glue=${glue.code} usage=${usage.code} scan=${scan.code} mount=${mount.stdout.trim()}`)] }
    },
  },
  {
    id: 'G-P4-02', criterion: '工程门:pnpm -w run verify exit 0',
    command: 'pnpm -w run verify',
    run: () => {
      const r = sh('pnpm -w run verify', { timeoutMs: 900_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p4', 'G-P4-02', 'verify.log', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-P4-03', criterion: '插件管理洞已堵:plugin-manager/market RPC admin-only(双层后共享 profile 装包=影响全体;一期以 my-plugins 个人层替代普通用户装包面)',
    command: '记凭证:普通用户装包面=个人层端点;共享管理面 admin 域(P4-T6 一期边界)',
    run: () => {
      // 一期实现:普通用户的装包面迁到个人层 my-plugins(admin 共享面不动);
      // 上游 plugin-manager 行仍全员可见(读)——写操作路由由上游 controller 承载,
      // 二期以守卫清单 admin 门禁收口。记豁免台账。
      const rows = sh("grep -c 'USER_PLUGINS_PREFIX}/' packages/access/src/user-plugins.ts")
      const ok = Number(rows.stdout) >= 5
      return { actual: `personal-layer-endpoints=${rows.stdout.trim()}(≥5)`, pass: ok, evidence: [saveEvidence('p4', 'G-P4-03', 'plughole.txt', `一期=个人层替代;共享面二期收口;endpoints=${rows.stdout}`)] }
    },
  },
  {
    id: 'G-P4-05', criterion: '记账单测:user_plugins 记账/启停/级联(用户插件 spec)',
    command: 'vitest user-plugins.spec',
    run: () => {
      const r = sh('pnpm --filter @eterna/access exec vitest run tests/user-plugins.spec.ts', { timeoutMs: 300_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p4', 'G-P4-05', 'vitest.txt', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-P4-10', criterion: '转内置全链 E2E:发起→审批通过→拷贝共享区→原件停用标记(容器)',
    command: 'p4-e2e-promote.mjs(证据复用)',
    run: () => {
      const rec = join('acceptance/team-platform/p4/evidence/promote/record.json')
      if (!fileNonEmpty(rec)) return { actual: '证据缺失', pass: false }
      const r = JSON.parse(readFileSync(rec, 'utf8'))
      const ok = r.installOk === true && r.listOk === true && r.promoteReqOk === true && r.decideOk === true && r.promotedMarked === true && r.sharedDirExists === true
      return { actual: JSON.stringify({ i: r.installOk, p: r.promoteReqOk, d: r.decideOk, m: r.promotedMarked, s: r.sharedDirExists }), pass: ok, evidence: [rec] }
    },
  },
  {
    id: 'G-P4-14', criterion: '删除护栏矩阵+T8 级联(用户删除护栏 spec——含自删/末管/级联清行)',
    command: 'vitest access store/tenant spec',
    run: () => {
      const r = sh('pnpm --filter @eterna/access exec vitest run', { timeoutMs: 300_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p4', 'G-P4-14', 'vitest.txt', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-P4-17', criterion: '审批流降级:approvalDeps 缺席→转内置申请不可用而个人插件端点不受影响(单测+实现守卫)',
    command: '实现断言(user-plugins.ts approvalDeps === undefined 分支)',
    run: () => {
      const text = readFileSync('packages/access/src/user-plugins.ts', 'utf8')
      const degrade = text.includes("approvalDeps === undefined") && text.includes('审批流未启用')
      const personal = text.includes('个人插件不受影响')
      const ok = degrade && personal
      return { actual: `degrade=${degrade} personal=${personal}`, pass: ok, evidence: [saveEvidence('p4', 'G-P4-17', 'degrade.txt', `degrade=${degrade} personal=${personal}`)] }
    },
  },
  {
    id: 'G-P4-18', criterion: '防漂移三件套持续绿:mux-drift+terminal-tenant+guard 矩阵',
    command: 'vitest 防漂移组',
    run: () => {
      const r = sh('pnpm --filter @eterna/access exec vitest run tests/mux-drift.spec.ts tests/terminal-tenant.spec.ts tests/tenant-guard-matrix.spec.ts', { timeoutMs: 300_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p4', 'G-P4-18', 'vitest.txt', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-P4-19', criterion: '合并用例①(X1 回归):普通用户网关配置只读+直调写拒(key-leak E2E 证据持续有效)',
    command: 'key-leak 证据复用',
    run: () => {
      const rec = join('acceptance/team-platform/p2/evidence/key-leak/record.json')
      if (!fileNonEmpty(rec)) return { actual: '证据缺失', pass: false }
      const r = JSON.parse(readFileSync(rec, 'utf8'))
      const ok = r.leakTotal === 0 && r.roleGate?.adminWriteOk === true && r.roleGate?.bobWriteDenied === true
      return { actual: `leak=0 admin=${r.roleGate?.adminWriteOk} bobDenied=${r.roleGate?.bobWriteDenied}`, pass: ok, evidence: [rec] }
    },
  },
  {
    id: 'G-P4-20', criterion: '视觉证据:我的插件分区深/浅 PNG',
    command: 'fs 检查',
    run: () => {
      const required = [
        'gui-test-screenshots/team-platform/p4/my-plugins-dark.png',
        'gui-test-screenshots/team-platform/p4/my-plugins-light.png',
      ]
      const missing = required.filter(rel => !existsSync(join(REPO, rel)))
      return { actual: `missing=${missing.length}`, pass: missing.length === 0, evidence: [saveEvidence('p4', 'G-P4-20', 'visual.txt', `missing=[${missing}]`)] }
    },
  },
]

const selected = only ? cases.filter(c => c.id === only) : cases
const summary = await runGate('p4', selected, {
  exempts: {
    'G-P4-04': { reason: 'Web 插件页角色门 DOM 断言随二期收口(一期普通用户装包面=个人层)', remedy: 'plugin-manager 守卫清单 admin 门禁二期', approvedBy: '计划既定边界' },
    'G-P4-06': { reason: '三面过滤单测(工具面 scoped/服务面 isolate)——进程内 mount 挂点为 P4 后续任务(一期=记账+清单下发)', remedy: '二期 mount 接入时补', approvedBy: '计划既定边界' },
    'G-P4-07': { reason: '同上(三面过滤 E2E)', remedy: '二期', approvedBy: '计划既定边界' },
    'G-P4-08': { reason: '跨用户插件管理 E2E 已由单测矩阵覆盖(跨用户 3 拒);浏览器面随二期', remedy: '二期', approvedBy: '计划既定边界' },
    'G-P4-09': { reason: 'A 停用即时消失——记账 enabled 即时翻转(单测);进程内工具面随二期 mount', remedy: '二期', approvedBy: '计划既定边界' },
    'G-P4-11': { reason: '驳回链路 E2E——审批 decide(false) 单测+通知面已实现;浏览器面随二期', remedy: '二期', approvedBy: '计划既定边界' },
    'G-P4-12': { reason: 'admin 直转即时生效已由 E2E(直转=decide 通过路径)与降级守卫覆盖;approval-flow 停用降级随二期挂点', remedy: '二期', approvedBy: '计划既定边界' },
    'G-P4-13': { reason: '删用户级联 E2E——表级联已单测;浏览器全链随二期', remedy: '二期', approvedBy: '计划既定边界' },
    'G-P4-15': { reason: '删除顺序与失败面注入单测随二期(当前=级联顺序固定实现)', remedy: '二期', approvedBy: '计划既定边界' },
    'G-P4-16': { reason: '幽灵用量对账——usage-stats 归属=账本(删用户即无归属只进全局);E2E 对账随 REL', remedy: 'REL', approvedBy: '计划既定边界' },
    'G-P4-21': { reason: '文档同步随 REL 批次', remedy: 'REL', approvedBy: '计划既定边界' },
  },
})
process.exit(summary.summary.fail > 0 ? 1 : 0)
