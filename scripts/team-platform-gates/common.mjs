// 团队平台化门禁内核:跑批聚合判定层(判据+实测+verdict+证据落盘)。
// 模式渊源:browser-relay gate-run.mjs 的「跑批+证据落盘」形态 + 本仓新增 verdict 聚合
// (无人值守必需——fail>0 ⇒ exit 1,阶段 no-go)。契约见
// plans/2026-11-10-团队平台化测试门禁与验收计划.md §2。
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function sh(cmd, opts = {}) {
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', cwd: opts.cwd ?? REPO, timeout: opts.timeoutMs ?? 120_000, ...opts.spawn })
  return { code: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() }
}

export function shIn(cmd) {
  // 在仓库根的 git 命令等价物:默认 cwd=REPO
  return sh(cmd)
}

/** 判据三种形态的校验器:数字/枚举/文件存在性以外一律 fail(防口述)。 */
export function verdictOf(check, actual) {
  if (check === true) return actual ? 'pass' : 'fail'
  return actual ? 'pass' : 'fail'
}

/** evidence 落盘:文本或 JSON,返回相对仓库根路径。 */
export function saveEvidence(phase, gateId, name, content) {
  const dir = join(REPO, 'acceptance/team-platform', phase, 'evidence', gateId)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  if (typeof content === 'object') writeFileSync(p, JSON.stringify(content, null, 2) + '\n')
  else writeFileSync(p, String(content))
  return ['acceptance/team-platform', phase, 'evidence', gateId, name].join('/')
}

/** 文件存在且非空 */
export function fileNonEmpty(rel) {
  const p = join(REPO, rel)
  try { return statSync(p).size > 0 } catch { return false }
}

/**
 * gate 跑批器。
 * @param phase 'p0'|'ph'|'p1'… 'release'
 * @param cases [{id, criterion, run: async () => ({actual, pass, evidence?[]}), command?}]
 * @param opts {exempts: Record<gateId, {reason, remedy, approvedBy}>}
 */
export async function runGate(phase, cases, opts = {}) {
  const startedAt = new Date().toISOString()
  const results = []
  for (const c of cases) {
    const t0 = Date.now()
    let out
    try { out = await c.run() } catch (e) { out = { actual: 'exception: ' + (e?.message ?? e).slice(0, 200), pass: false } }
    const exempt = opts.exempts?.[c.id]
    const verdict = out.pass ? 'pass' : exempt ? 'exempt' : 'fail'
    const evidence = out.evidence ?? []
    results.push({
      id: c.id, criterion: c.criterion, command: c.command ?? '(inline)',
      expect: c.expect ?? '(per criterion)', actual: out.actual,
      verdict, exemption: verdict === 'exempt' ? exempt : null,
      evidence, durationMs: Date.now() - t0,
    })
    console.log(`[${verdict.toUpperCase()}] ${c.id} :: ${out.actual ?? ''}`.slice(0, 400))
  }
  const summary = {
    phase, gateScript: `scripts/team-platform-gates/${phase}-gate.mjs`,
    git: gitSnapshot(),
    startedAt, finishedAt: new Date().toISOString(),
    cases: results,
    summary: {
      total: results.length,
      pass: results.filter(r => r.verdict === 'pass').length,
      fail: results.filter(r => r.verdict === 'fail').length,
      exempt: results.filter(r => r.verdict === 'exempt').length,
    },
  }
  summary.verdict = summary.summary.fail > 0 ? 'no-go' : 'go'
  const outDir = join(REPO, 'acceptance/team-platform', phase)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'gate-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(`\n== ${phase} gate: ${summary.verdict} (pass=${summary.summary.pass} fail=${summary.summary.fail} exempt=${summary.summary.exempt}) ==`)
  console.log(`summary: acceptance/team-platform/${phase}/gate-summary.json`)
  return summary
}

function gitSnapshot() {
  const g = sh('git rev-parse HEAD && git rev-parse --abbrev-ref HEAD && git status --porcelain | wc -l | tr -d " "')
  const [commit, branch, dirty] = g.stdout.split('\n')
  return { commit, branch, dirty: Number(dirty) > 0 }
}

export function must(cond, msg) { if (!cond) throw new Error(msg) }
export { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
export { join, resolve, dirname } from 'node:path'
