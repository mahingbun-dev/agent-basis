// P0 准备阶段门禁:G-P0-01…10(判据见 plans/2026-11-10-团队平台化测试门禁与验收计划.md §3.1)。
// 用法: node scripts/team-platform-gates/p0-gate.mjs [--only G-P0-0x]
import { runGate, sh, saveEvidence, fileNonEmpty, readFileSync, existsSync, REPO } from './common.mjs'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

/** 三家 key 最小连通探测(key 从 .secrets 读入进程,不进 argv/日志)。 */
async function probeProviders() {
  const targets = [
    { name: 'deepseek', url: 'https://api.deepseek.com/models' },
    { name: 'mimo', url: 'https://api.xiaomimimo.com/v1/models' },
    { name: 'glm', url: 'https://open.bigmodel.cn/api/paas/v4/models' },
  ]
  const out = {}
  for (const t of targets) {
    const key = readFileSync(join(REPO, '.secrets', `${t.name}-api-key.txt`), 'utf8').trim()
    const t0 = Date.now()
    try {
      const r = await fetch(t.url, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) })
      out[t.name] = { status: r.status, latencyMs: Date.now() - t0 }
    } catch (e) {
      out[t.name] = { status: 'network-error', error: String(e?.cause?.code ?? e.message).slice(0, 80), latencyMs: Date.now() - t0 }
    }
  }
  return out
}

const cases = [
  {
    id: 'G-P0-01',
    criterion: 'worktree feat/team-platform HEAD == 建树时 origin/main；worktree list 恰含 agent-basis-team 一个新增',
    command: 'git rev-parse HEAD / git worktree list',
    run: () => {
      const head = sh('git -C ../agent-basis-team rev-parse HEAD')
      const main = sh('git rev-parse origin/main')
      const base = sh('git -C ../agent-basis-team merge-base origin/main HEAD')
      const list = sh('git worktree list')
      const teamCount = (list.stdout.match(/agent-basis-team/g) ?? []).length
      const onBase = base.code === 0 && base.stdout === main.stdout
      const ok = head.code === 0 && onBase && teamCount === 1
      const evidence = saveEvidence('p0', 'G-P0-01', 'baseline.txt',
        `origin/main=${main.stdout}\nworktree HEAD=${head.stdout}\nmerge-base=${base.stdout}\nonBase=${onBase}(分支可领先,分叉即红)\nworktrees:\n${list.stdout}\n${new Date().toISOString()}`)
      return { actual: `mergeBase==origin/main:${onBase} teamWorktrees:${teamCount}`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-02',
    criterion: '.secrets 三家 key 文件存在、0600、gitignored、无任何提交历史',
    command: 'node scripts/team-platform-gates/p0-gate.mjs --only G-P0-02',
    run: () => {
      const files = ['deepseek-api-key.txt', 'mimo-api-key.txt', 'glm-api-key.txt']
      const detail = {}
      let ok = true
      for (const f of files) {
        const rel = '.secrets/' + f
        let mode = null
        try { mode = (statSync(join('../agent-basis-team', rel)).mode & 0o777).toString(8) } catch {}
        const ignored = sh(`git -C ../agent-basis-team check-ignore ${rel}`).code === 0
        const hist = sh(`git -C ../agent-basis-team log --all --full-history --oneline -- ${rel} | wc -l | tr -d " "`).stdout
        const exists = existsSync(join('../agent-basis-team', rel))
        detail[f] = { exists, mode, ignored, historyCommits: Number(hist) }
        ok = ok && exists && mode === '600' && ignored && Number(hist) === 0
      }
      const evidence = saveEvidence('p0', 'G-P0-02', 'secrets-audit.json', detail)
      return { actual: JSON.stringify(detail), pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-03',
    criterion: '三家 key 最小连通各 1 次:GET /models HTTP 200,延迟 <10s;key 不进 argv',
    command: 'node scripts/team-platform-gates/p0-gate.mjs --only G-P0-03',
    run: async () => {
      const out = await probeProviders()
      const ok = Object.values(out).every(v => v.status === 200 && v.latencyMs < 10000)
      const evidence = saveEvidence('p0', 'G-P0-03', 'probe.json', out)
      return { actual: JSON.stringify(out), pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-04',
    criterion: 'docs/dev/llm-gateway-zcode对照.md 存在且覆盖五维度(thinking/usage/多模态/联网/协议),行数 ≥120,带来源条目 ≥20',
    command: 'grep 五维度关键词 + 行数统计',
    run: () => {
      const rel = 'docs/dev/llm-gateway-zcode对照.md'
      if (!fileNonEmpty(rel)) return { actual: '文档不存在或为空', pass: false }
      const text = readFileSync(rel, 'utf8')
      const dims = ['thinking', 'usage', '多模态', '联网', '协议']
      const missing = dims.filter(d => !text.toLowerCase().includes(d.toLowerCase()))
      const lines = text.split('\n').length
      const sources = (text.match(/zcode-ref|docs\.deepseek|docs\.bigmodel|mimo\.mi|pi-ai|openai-completions\.js/g) ?? []).length
      const ok = missing.length === 0 && lines >= 120 && sources >= 20
      const evidence = saveEvidence('p0', 'G-P0-04', 'doc-check.json', { missing, lines, sourceHits: sources })
      return { actual: `lines=${lines} sources=${sources} missingDims=[${missing}]`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-05',
    criterion: 'governance 方案 A 已在基线(origin/main:docker/profile/governance.rules.yml 含 default: ask 与 allow-shell);glue 回归全绿',
    command: 'git show origin/main:docker/profile/governance.rules.yml + pnpm --filter @eterna/glue run test',
    run: () => {
      const shown = sh('git show origin/main:docker/profile/governance.rules.yml')
      const hasAsk = shown.stdout.includes('default: ask')
      const hasShell = shown.stdout.includes('allow-shell')
      const vit = sh('pnpm --filter @eterna/glue run test', { timeoutMs: 300_000 })
      const ok = shown.code === 0 && hasAsk && hasShell && vit.code === 0
      const evidence = saveEvidence('p0', 'G-P0-05', 'governance-baseline.txt',
        `defaultAsk=${hasAsk} allowShell=${hasShell}\n--- glue vitest tail ---\n${vit.stdout.slice(-800)}`)
      return { actual: `default:ask=${hasAsk} allow-shell=${hasShell} glueExit=${vit.code}`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-06',
    criterion: '根工程门:pnpm -w run verify exit 0',
    command: 'pnpm -w run verify',
    run: () => {
      const r = sh('pnpm -w run verify', { timeoutMs: 900_000 })
      const evidence = saveEvidence('p0', 'G-P0-06', 'verify.log', r.stdout + '\n---stderr---\n' + r.stderr)
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-07',
    criterion: 'tenant-scan(team worktree 内)= 0 finding(s)',
    command: 'node tools/packctl/bin/packctl.mjs tenant-scan',
    run: () => {
      const r = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const ok = r.code === 0 && /0 finding/i.test(r.stdout)
      const evidence = saveEvidence('p0', 'G-P0-07', 'tenant-scan.txt', r.stdout + '\n' + r.stderr)
      return { actual: `exit=${r.code} :: ${(r.stdout.match(/\d+ finding\(s\)/) ?? ['?'])[0]}`, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-08',
    criterion: 'CI 绿:分支 feat/team-platform 最近一次 Actions verify job conclusion=success',
    command: 'gh run list --branch feat/team-platform --limit 1 --json conclusion,workflow',
    run: () => {
      const r = sh('gh run list --branch feat/team-platform --limit 1 --json conclusion,workflow,name')
      let ok = false, actual = 'no runs yet'
      if (r.code === 0 && r.stdout.trim()) {
        try {
          const runs = JSON.parse(r.stdout)
          if (Array.isArray(runs) && runs.length > 0) {
            actual = JSON.stringify(runs[0])
            ok = runs.some(x => x.conclusion === 'success')
          }
        } catch { actual = 'parse-error: ' + r.stdout.slice(0, 120) }
      }
      const evidence = saveEvidence('p0', 'G-P0-08', 'ci.json', { raw: r.stdout || actual })
      return { actual, pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-09',
    criterion: 'zcode-ref 只读纪律:git status --porcelain 输出为空',
    command: 'git -C /Users/sunny/code/zcode-ref status --porcelain',
    run: () => {
      const r = sh('git -C /Users/sunny/code/zcode-ref status --porcelain')
      const ok = r.code === 0 && r.stdout === ''
      const evidence = saveEvidence('p0', 'G-P0-09', 'zcode-clean.txt', r.stdout || '(clean)\n')
      return { actual: r.stdout === '' ? 'clean' : r.stdout.slice(0, 200), pass: ok, evidence: [evidence] }
    },
  },
  {
    id: 'G-P0-10',
    criterion: '计划回填:p0/evidence/baseline-note.md 存在(R1 基线注记:main/dev 已同步 e5901b4)',
    command: 'fs 检查',
    run: () => {
      const ok = fileNonEmpty('acceptance/team-platform/p0/evidence/baseline-note.md')
      return { actual: ok ? 'present' : 'missing', pass: ok, evidence: ['acceptance/team-platform/p0/evidence/baseline-note.md'] }
    },
  },
]

function require0() { return undefined }
const filtered = only ? cases.filter(c => c.id === only) : cases
const summary = await runGate('p0', filtered, { exempts: {} })
process.exit(summary.summary.fail > 0 ? 1 : 0)
