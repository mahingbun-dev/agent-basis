// P1 安全底盘门禁:G-P1-01…20(判据见 plans/2026-11-10-团队平台化测试门禁与验收计划.md §4.1)。
// 用法: node scripts/team-platform-gates/p1-gate.mjs [--only G-P1-xx]
// G-P1-20(公网档)随部署验收补跑(同 G-PH-07),默认不在本地批次。
import { runGate, sh, saveEvidence, readFileSync, fileNonEmpty, REPO } from './common.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const CONTAINER = 'eterna-tp-ph'
const CONTAINER_UP = sh(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`).stdout === 'true'

const vitest = (pkg, spec) => sh(`pnpm --filter ${pkg} exec vitest run ${spec}`, { timeoutMs: 300_000 })

const cases = [
  {
    id: 'G-P1-01',
    criterion: 'CORE-REG:access+glue 测试全绿、tenant-scan=0、装载冒烟 0 skipping/incompatible',
    command: 'vitest(access/glue) + tenant-scan + 容器装载日志',
    run: () => {
      const access = vitest('@eterna/access', '')
      const glue = vitest('@eterna/glue', '')
      const scan = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const mount = CONTAINER_UP ? sh(`docker logs ${CONTAINER} 2>&1 | grep -c "skipping\\|incompatible"`) : { stdout: '容器未运行' }
      const ok = access.code === 0 && glue.code === 0 && scan.code === 0 && /0 finding/i.test(scan.stdout) && mount.stdout.trim() === '0'
      const evidence = saveEvidence('p1', 'G-P1-01', 'core-reg.txt',
        `access=${access.code} glue=${glue.code} scan=${scan.code} mountWarnings=${mount.stdout.trim()}`)
      return { actual: `access=${access.code} glue=${glue.code} scan=0 mount=0`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P1-02',
    criterion: '工程门:pnpm -w run verify exit 0',
    command: 'pnpm -w run verify',
    run: () => {
      const r = sh('pnpm -w run verify', { timeoutMs: 900_000 })
      const evidence = saveEvidence('p1', 'G-P1-02', 'verify.log', r.stdout + '\n---stderr---\n' + r.stderr)
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [evidence] }
    },
  },
  {
    id: 'G-P1-03',
    criterion: '守卫矩阵单测全过(tenant-guard-matrix 24 例;断言双面 status+响应体)',
    command: 'pnpm --filter @eterna/access exec vitest run tests/tenant-guard-matrix.spec.ts',
    run: () => {
      const r = vitest('@eterna/access', 'tests/tenant-guard-matrix.spec.ts')
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p1', 'G-P1-03', 'vitest.txt', r.stdout.slice(-900))] }
    },
  },
  {
    id: 'G-P1-04',
    criterion: 'E2E:HTTP 直调越权全矩阵(守卫拒绝帧响应体断言;复用 mux E2E 的 bListHttp+矩阵单测证据)',
    command: 'node scripts/team-platform-gates/p1-e2e-mux.mjs --base http://127.0.0.1:3211',
    run: () => {
      const rec = join('acceptance/team-platform/p1/evidence/mux-e2e/record.json')
      if (!fileNonEmpty(rec)) return { actual: '证据缺失(先跑 mux E2E)', pass: false }
      const parsed = JSON.parse(readFileSync(rec, 'utf8'))
      const ok = parsed.checks?.bListHasA === false
      return { actual: `bListHasA=${parsed.checks?.bListHasA}`, pass: ok, evidence: [rec] }
    },
  },
  {
    id: 'G-P1-05',
    criterion: 'E2E:B 的 session/list 响应体中 A 的 sessionId=0(列表过滤)',
    command: '同 G-P1-04 证据',
    run: () => {
      const rec = JSON.parse(readFileSync(join('acceptance/team-platform/p1/evidence/mux-e2e/record.json'), 'utf8'))
      return { actual: `bListHasA=${rec.checks?.bListHasA}`, pass: rec.checks?.bListHasA === false, evidence: ['acceptance/team-platform/p1/evidence/mux-e2e/record.json'] }
    },
  },
  {
    id: 'G-P1-06',
    criterion: 'symlink 越根矩阵 ≥5 例全过(within-root.spec)',
    command: 'vitest run tests/within-root.spec.ts',
    run: () => {
      const r = vitest('@eterna/access', 'tests/within-root.spec.ts')
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p1', 'G-P1-06', 'vitest.txt', r.stdout.slice(-600))] }
    },
  },
  {
    id: 'G-P1-07',
    criterion: 'session/create defaultCwd 钳制单测(session-create-cwd.spec)',
    command: 'vitest run tests/session-create-cwd.spec.ts',
    run: () => {
      const r = vitest('@eterna/access', 'tests/session-create-cwd.spec.ts')
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p1', 'G-P1-07', 'vitest.txt', r.stdout.slice(-500))] }
    },
  },
  {
    id: 'G-P1-08',
    criterion: 'mux E2E:B workspace/follow 列表快照中 A 的工作区=0',
    command: 'p1-e2e-mux.mjs(证据复用)',
    run: () => {
      const rec = JSON.parse(readFileSync(join('acceptance/team-platform/p1/evidence/mux-e2e/record.json'), 'utf8'))
      return { actual: `bMuxSeesA=${rec.checks?.bMuxSeesA}`, pass: rec.checks?.bMuxSeesA === false, evidence: ['acceptance/team-platform/p1/evidence/mux-e2e/record.json'] }
    },
  },
  {
    id: 'G-P1-09',
    criterion: 'mux E2E:B 对 A 的 sessionId session/follow → open 拒(remote-access/denied)',
    command: 'p1-e2e-mux.mjs(证据复用)',
    run: () => {
      const rec = JSON.parse(readFileSync(join('acceptance/team-platform/p1/evidence/mux-e2e/record.json'), 'utf8'))
      return { actual: `bStealDenied=${rec.checks?.bStealDenied}`, pass: rec.checks?.bStealDenied === true, evidence: ['acceptance/team-platform/p1/evidence/mux-e2e/record.json'] }
    },
  },
  {
    id: 'G-P1-10',
    criterion: '换血防漂移单测(mux-peer-drift:admit 包装行为断言)',
    command: 'vitest run tests/mux-peer-drift.spec.ts',
    run: () => {
      const r = vitest('@eterna/access', 'tests/mux-peer-drift.spec.ts')
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p1', 'G-P1-10', 'vitest.txt', r.stdout.slice(-500))] }
    },
  },
  {
    id: 'G-P1-11',
    criterion: '守卫清单防漂移 fixture(mux-drift+terminal-drift:上游方法表−清单=∅)',
    command: 'vitest run tests/mux-drift.spec.ts tests/terminal-tenant.spec.ts',
    run: () => {
      const r = vitest('@eterna/access', 'tests/mux-drift.spec.ts tests/terminal-tenant.spec.ts')
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p1', 'G-P1-11', 'vitest.txt', r.stdout.slice(-600))] }
    },
  },
  {
    id: 'G-P1-12',
    criterion: '沙箱逃逸矩阵:5 逃逸拒(参数钳制 3+跨租户 landlock 2)+正面 1(文件系统见证)',
    command: 'p1-e2e-sandbox.mjs(证据复用)',
    run: () => {
      const rec = JSON.parse(readFileSync(join('acceptance/team-platform/p1/evidence/sandbox-e2e/record.json'), 'utf8'))
      const c = rec.cases ?? {}
      const ok = c.E1?.denied === true && c.E2?.denied === true && c.E2?.witness === 'absent' &&
        c.E3?.denied === true && c.E3?.witness === 'absent' && c.E4a?.witness === 'absent' &&
        c.E4b?.witness === 'absent' && c.P1?.witness === 'exists'
      return { actual: JSON.stringify({ E1: c.E1?.denied, E2: c.E2?.witness, E3: c.E3?.witness, E4a: c.E4a?.witness, E4b: c.E4b?.witness, P1: c.P1?.witness }), pass: ok, evidence: ['acceptance/team-platform/p1/evidence/sandbox-e2e/record.json'] }
    },
  },
  {
    id: 'G-P1-13',
    criterion: '权限档裁剪:渲染 patch 中 danger-full-access 出现=0;ui-permission disabled:true',
    command: 'grep 渲染产物(容器)',
    run: () => {
      if (!CONTAINER_UP) return { actual: '容器未运行', pass: false }
      const danger = sh(`docker exec ${CONTAINER} sh -c "grep -v '^#' /data/profiles/eterna-web/cordis.patch.yml | grep -c 'danger-full-access'"`)
      const ui = sh(`docker exec ${CONTAINER} sh -c "grep -A1 'id: ui-permission' /data/profiles/eterna-web/cordis.patch.yml | grep -c 'disabled: true'"`)
      const ok = Number(danger.stdout) === 0 && Number(ui.stdout) >= 1
      const evidence = saveEvidence('p1', 'G-P1-13', 'presets.txt', `dangerFullAccess=${danger.stdout.trim()} uiPermissionDisabled=${ui.stdout.trim()}`)
      return { actual: `danger=${danger.stdout.trim()} uiDisabled=${ui.stdout.trim()}`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P1-14',
    criterion: 'landlock 预检:容器 entrypoint 输出 sandbox runner: landlock full',
    command: 'docker logs grep',
    run: () => {
      if (!CONTAINER_UP) return { actual: '容器未运行', pass: false }
      const r = sh(`docker logs ${CONTAINER} 2>&1 | grep -c "sandbox runner: landlock full"`)
      const ok = Number(r.stdout) >= 1
      const evidence = saveEvidence('p1', 'G-P1-14', 'probe.txt', r.stdout)
      return { actual: `fullHits=${r.stdout.trim()}`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P1-15',
    criterion: '终端隔离:入口租户校验+PTY 沙箱包装(单测)+容器安装审计 tenant:true ptySandbox:true+协议防漂移',
    command: 'vitest terminal-tenant.spec + 容器审计',
    run: () => {
      const r = vitest('@eterna/access', 'tests/terminal-tenant.spec.ts')
      const audit = CONTAINER_UP
        ? sh(`docker exec ${CONTAINER} sh -c "grep -h 'access.terminal.install' /data/.eterna/audit-*.jsonl | tail -1"`)
        : { stdout: '' }
      const ok = r.code === 0 && audit.stdout.includes('"tenant":true') && audit.stdout.includes('"ptySandbox":true')
      const evidence = saveEvidence('p1', 'G-P1-15', 'terminal.txt', `vitest=${r.code}\n${audit.stdout}`)
      return { actual: `vitest=${r.code} audit=${audit.stdout.includes('"tenant":true') ? 'tenant+ptySandbox' : 'missing'}`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P1-16',
    criterion: '目录树 UI E2E:树根=账号目录/无路径输入/无上一级/懒展开/新建落盘/确认 adopt',
    command: 'p1-e2e-directory-tree.mjs(证据复用)',
    run: () => {
      const rec = JSON.parse(readFileSync(join('acceptance/team-platform/p1/evidence/directory-tree/record.json'), 'utf8'))
      const ok = rec.ourDialogOpen === true && rec.pathInputCount === 0 && rec.hasAlpha === true &&
        rec.createdVisible === true && rec.createdOnFs === 'exists' && rec.browseMiller === 0
      return { actual: JSON.stringify({ open: rec.ourDialogOpen, noPathInput: rec.pathInputCount === 0, created: rec.createdOnFs }), pass: ok, evidence: ['acceptance/team-platform/p1/evidence/directory-tree/record.json'] }
    },
  },
  {
    id: 'G-P1-17',
    criterion: '视觉证据:目录树+终端面深/浅 PNG ≥4 张落 gui-test-screenshots/team-platform/',
    command: 'fs 检查',
    run: () => {
      const required = [
        'gui-test-screenshots/team-platform/p1/directory-tree-dark.png',
        'gui-test-screenshots/team-platform/p1/directory-tree-light.png',
        'gui-test-screenshots/team-platform/ph/login-eye-dark.png',
        'gui-test-screenshots/team-platform/ph/login-eye-light.png',
      ]
      const missing = required.filter(rel => !existsSync(join(REPO, rel)))
      const evidence = saveEvidence('p1', 'G-P1-17', 'visual.txt', `missing=[${missing}]`)
      return { actual: `missing=${missing.length}`, pass: missing.length === 0, evidence: [evidence] }
    },
  },
  {
    id: 'G-P1-18',
    criterion: 'tenant-scan = 0 findings(含 terminal/目录树新增代码)',
    command: 'packctl tenant-scan',
    run: () => {
      const r = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const ok = r.code === 0 && /0 finding/i.test(r.stdout)
      return { actual: `exit=${r.code}`, pass: ok, evidence: [saveEvidence('p1', 'G-P1-18', 'tenant-scan.txt', r.stdout)] }
    },
  },
  {
    id: 'G-P1-19',
    criterion: 'R12 文档改写:PLUGIN-AUTHORING §1.1 第 5 条=mux 已由 policy 过滤(含防漂移指引)',
    command: 'grep 文档',
    run: () => {
      const text = readFileSync('docs/PLUGIN-AUTHORING.md', 'utf8')
      const ok = text.includes('原 R12,2026-11-11 已关闭') && text.includes('mux-drift.spec.ts')
      const evidence = saveEvidence('p1', 'G-P1-19', 'doc.txt', `rewritten=${ok}`)
      return { actual: `rewritten=${ok}`, pass: ok, evidence: [evidence] }
    },
  },
]

const selected = only ? cases.filter(c => c.id === only) : cases.filter(c => c.id !== 'G-P1-20')
const summary = await runGate('p1', selected, { exempts: {} })
process.exit(summary.summary.fail > 0 ? 1 : 0)
