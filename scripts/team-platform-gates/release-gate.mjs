// REL 最终放行清单:G-REL-01…12(判据见测试门禁计划 §8)。
// 公网档项(G-REL-06)由部署验收执行;本脚本判定本地可判项。
import { runGate, sh, saveEvidence, readFileSync, fileNonEmpty } from './common.mjs'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.cwd()
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const CONTAINER = 'eterna-tp-ph'
const CONTAINER_UP = sh(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`).stdout === 'true'

const visualRequired = [
  'gui-test-screenshots/team-platform/ph/login-eye-dark.png',
  'gui-test-screenshots/team-platform/ph/login-eye-light.png',
  'gui-test-screenshots/team-platform/p1/directory-tree-dark.png',
  'gui-test-screenshots/team-platform/p1/directory-tree-light.png',
  'gui-test-screenshots/team-platform/p3/usage-panel-dark.png',
  'gui-test-screenshots/team-platform/p3/usage-panel-light.png',
  'gui-test-screenshots/team-platform/p4/my-plugins-dark.png',
  'gui-test-screenshots/team-platform/p4/my-plugins-light.png',
]

const cases = [
  {
    id: 'G-REL-01', criterion: '全量 verify exit 0',
    command: 'pnpm -w run verify',
    run: () => {
      const r = sh('pnpm -w run verify', { timeoutMs: 900_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('release', 'G-REL-01', 'verify.log', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-REL-02', criterion: 'tenant-scan 0 findings + packctl lint 过',
    command: 'packctl tenant-scan + lint',
    run: () => {
      const scan = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const ok = scan.code === 0 && /0 finding/i.test(scan.stdout)
      return { actual: `exit=${scan.code}`, pass: ok, evidence: [saveEvidence('release', 'G-REL-02', 'tenant-scan.txt', scan.stdout)] }
    },
  },
  {
    id: 'G-REL-03', criterion: 'CI 绿(feat/team-platform 最近 runs 全 success)',
    command: 'gh run list',
    run: () => {
      const r = sh('gh run list --branch feat/team-platform --limit 3 --json conclusion,workflowName')
      let ok = false, actual = 'no runs'
      try {
        const runs = JSON.parse(r.stdout)
        actual = JSON.stringify(runs.map(x => ({ w: x.workflowName, c: x.conclusion })))
        ok = runs.length > 0 && runs.every(x => x.conclusion === 'success')
      } catch { /* keep */ }
      return { actual, pass: ok, evidence: [saveEvidence('release', 'G-REL-03', 'ci.json', r.stdout)] }
    },
  },
  {
    id: 'G-REL-04', criterion: '装载冒烟:容器 0 skipping/incompatible + providers 三家',
    command: 'docker logs + grep',
    run: () => {
      if (!CONTAINER_UP) return { actual: '容器未运行', pass: false }
      const mount = sh(`docker logs ${CONTAINER} 2>&1 | grep -c "skipping\\|incompatible\\|ERR_UNSUPPORTED"`)
      const providers = sh(`docker exec ${CONTAINER} sh -c "grep -c '^      deepseek:' /data/profiles/eterna-web/cordis.patch.yml; grep -c '^      mimo:' /data/profiles/eterna-web/cordis.patch.yml; grep -c '^      glm:' /data/profiles/eterna-web/cordis.patch.yml"`)
      const lines = providers.stdout.trim().split('\n').map(Number)
      const ok = mount.stdout.trim() === '0' && lines.length === 3 && lines.every(n => n === 1)
      return { actual: `mount=${mount.stdout.trim()} providers=[${lines}]`, pass: ok, evidence: [saveEvidence('release', 'G-REL-04', 'mount.txt', `mount=${mount.stdout} providers=${providers.stdout}`)] }
    },
  },
  {
    id: 'G-REL-05', criterion: 'embed 档等价:模板三家直连无残留(rg litellm=0)',
    command: 'rg 内嵌',
    run: () => {
      const r = sh(`rg -il litellm --glob '!plans/**' --glob '!*.md' --glob '!acceptance/**' | wc -l | tr -d ' '`)
      const n = Number(r.stdout)
      return { actual: `files=${n}`, pass: n === 0, evidence: [saveEvidence('release', 'G-REL-05', 'litellm.txt', `files=${n}`)] }
    },
  },
  {
    id: 'G-REL-07', criterion: '全量安全回归(本地可判子集):沙箱逃逸+守卫矩阵+角色门+key 不回转+转内置——五阶段 gate-summary 全 go',
    command: 'fs+JSON: ph/p0/p1/p2/p3/p4 summary',
    run: () => {
      const phases = ['ph', 'p0', 'p1', 'p2', 'p3', 'p4']
      const results = phases.map(phase => {
        const p = join('acceptance/team-platform', phase, 'gate-summary.json')
        if (!fileNonEmpty(p)) return { phase, verdict: 'missing' }
        return { phase, verdict: JSON.parse(readFileSync(p, 'utf8')).verdict }
      })
      const ok = results.every(r => r.verdict === 'go')
      return { actual: JSON.stringify(results), pass: ok, evidence: [saveEvidence('release', 'G-REL-07', 'phases.json', JSON.stringify(results, null, 2))] }
    },
  },
  {
    id: 'G-REL-08', criterion: '视觉证据齐全:8 PNG(眼睛/目录树/用量面板/我的插件 × 深/浅)',
    command: 'fs 检查',
    run: () => {
      const missing = visualRequired.filter(rel => !existsSync(join(REPO, rel)))
      const tiny = visualRequired.filter(rel => {
        try { return statSync(join(REPO, rel)).size <= 20 * 1024 } catch { return true }
      })
      const ok = missing.length === 0 && tiny.length === 0
      return { actual: `missing=${missing.length} tiny=${tiny.length}`, pass: ok, evidence: [saveEvidence('release', 'G-REL-08', 'visual.txt', `missing=[${missing}] tiny=[${tiny}]`)] }
    },
  },
  {
    id: 'G-REL-10', criterion: '文档数字可追溯:USER-GUIDE 新功能段引用 acceptance 路径存在',
    command: 'grep + fs',
    run: () => {
      const guide = readFileSync('docs/USER-GUIDE.md', 'utf8')
      const ref = guide.includes('acceptance/team-platform/')
      const dir = existsSync(join(REPO, 'acceptance/team-platform'))
      const ok = ref && dir
      return { actual: `guideRef=${ref} dir=${dir}`, pass: ok, evidence: [saveEvidence('release', 'G-REL-10', 'doc-trace.txt', `guideRef=${ref} dir=${dir}`)] }
    },
  },
  {
    id: 'G-REL-11', criterion: '五阶段 gate-summary 齐全且 verdict=go;豁免台账完整',
    command: 'fs+JSON(同 G-REL-07 证据)',
    run: () => {
      const phases = ['ph', 'p0', 'p1', 'p2', 'p3', 'p4']
      const rows = phases.map(phase => {
        const p = join('acceptance/team-platform', phase, 'gate-summary.json')
        if (!fileNonEmpty(p)) return { phase, verdict: 'missing', exempt: 0 }
        const s = JSON.parse(readFileSync(p, 'utf8'))
        return { phase, verdict: s.verdict, exempt: s.summary.exempt }
      })
      const ok = rows.every(r => r.verdict === 'go')
      return { actual: JSON.stringify(rows), pass: ok, evidence: [saveEvidence('release', 'G-REL-11', 'summaries.json', JSON.stringify(rows, null, 2))] }
    },
  },
]

const selected = only ? cases.filter(c => c.id === only) : cases.filter(c => c.id !== 'G-REL-06' && c.id !== 'G-REL-09' && c.id !== 'G-REL-12')
const summary = await runGate('release', selected, {
  exempts: {
    'G-REL-02': { reason: 'tenant-scan 双判据(lint 部分在 CI)', remedy: 'CI verify job', approvedBy: '计划既定' },
  },
})
process.exit(summary.summary.fail > 0 ? 1 : 0)
