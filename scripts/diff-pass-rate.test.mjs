/**
 * diff-pass-rate.mjs 单测(G2-A9;53 号 §4-P1):
 * JSONL 与 report.md 双格式解析、目录输入(JSON 优先)、差值与阈值判定(≤ 过/> 拒)、
 * --threshold 自定义、case 不对齐明细、坏输入退出码 2、--json 机器可读面。
 * 零依赖 node --test(与 docker/profile/transplant-profile.test.mjs 同先例);
 * 阈值口径:路由金集通过率差 ≤2 个百分点视为无衰减(tests/route-golden/README.md)。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffPassRate, parseJsonlReport, parseMarkdownReport, passRateOf, runDiff } from './diff-pass-rate.mjs'

/** 造一份 sessions.jsonl 文本:n 条,passCount 条 pass(case id 全不同)。 */
const jsonl = (total, passCount) => Array.from({ length: total }, (_, index) => JSON.stringify({
  case_id: `rg-${String(index + 1).padStart(2, '0')}`,
  status: index < passCount ? 'pass' : 'fail',
})).join('\n') + '\n'

/** 造一份 report.md 文本(对齐 tools/evals/src/report.ts 的「## 用例明细」渲染)。 */
const markdown = (ids, statuses) => [
  '# DSH Evals Report', '',
  '## 总览', '',
  '## 用例明细', '',
  '| id | adapter | status | tags | 失败分类 |', '|---|---|---|---|---|',
  ...ids.map((id, index) => `| ${id} | replay | ${statuses[index]} | route-golden | - |`),
  '',
].join('\n')

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'diff-pass-rate-test-'))
}

test('passRateOf:20/20 与 19/20 的通过率', () => {
  assert.deepEqual(passRateOf(parseJsonlReport(jsonl(20, 20), 'a')), { total: 20, pass: 20, rate: 100 })
  const rate = passRateOf(parseJsonlReport(jsonl(20, 19), 'b'))
  assert.equal(rate.total, 20)
  assert.equal(rate.pass, 19)
  assert.equal(rate.rate, 95)
})

test('runDiff:同报告 delta 0 → 退出码 0', () => {
  const dir = tmpDir()
  try {
    const a = join(dir, 'a.jsonl')
    writeFileSync(a, jsonl(20, 20))
    const outcome = runDiff(a, a)
    assert.equal(outcome.code, 0)
    assert.match(outcome.summaryText.join('\n'), /delta    : 0\.0 pp/)
    assert.match(outcome.summaryText.join('\n'), /无衰减/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('runDiff:19/20 vs 20/20 = 5pp > 默认阈值 2 → 退出码 1', () => {
  const dir = tmpDir()
  try {
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, jsonl(20, 20))
    writeFileSync(b, jsonl(20, 19))
    const outcome = runDiff(a, b)
    assert.equal(outcome.code, 1)
    assert.match(outcome.summaryText.join('\n'), /delta    : 5\.0 pp/)
    assert.match(outcome.summaryText.join('\n'), /衰减超标/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('runDiff:差值恰好等于阈值 → 无衰减(≤ 判定)', () => {
  const dir = tmpDir()
  try {
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, jsonl(20, 20))
    writeFileSync(b, jsonl(20, 19))
    assert.equal(runDiff(a, b, { threshold: 5 }).code, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('runDiff:--threshold 自定义收紧(1pp 拒 5pp 差)', () => {
  const dir = tmpDir()
  try {
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, jsonl(20, 20))
    writeFileSync(b, jsonl(20, 19))
    assert.equal(runDiff(a, b, { threshold: 1 }).code, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('diffPassRate:case 不对齐时列出明细且按各自 total 归一', () => {
  const baseline = parseJsonlReport(jsonl(20, 20), 'a')
  const compacted = new Map([...parseJsonlReport(jsonl(19, 19), 'b').entries(), ['rg-extra', 'pass']])
  const outcome = diffPassRate(baseline, compacted)
  assert.deepEqual(outcome.baseline, { total: 20, pass: 20, rate: 100 })
  assert.deepEqual(outcome.compacted, { total: 20, pass: 20, rate: 100 })
  assert.equal(outcome.delta, 0)
  // missing.X = X 侧缺失(仅对侧有)的 case id。
  assert.deepEqual(outcome.missing.baseline, ['rg-extra'])
  assert.deepEqual(outcome.missing.compacted, ['rg-20'])
})

test('parseMarkdownReport:report.md 明细表解析(表头/分隔行跳过)', () => {
  const cases = parseMarkdownReport(markdown(['rg-01', 'rg-02'], ['pass', 'fail']), 'md')
  assert.equal(cases.size, 2)
  assert.equal(cases.get('rg-01'), 'pass')
  assert.equal(cases.get('rg-02'), 'fail')
})

test('parseMarkdownReport:明细缺失 → 报错', () => {
  assert.throws(() => parseMarkdownReport('# Report\n\n无明细\n', 'md'), /未解析到任何用例明细/)
})

test('parseJsonlReport:坏行(非 JSON / 缺字段)→ 带行号报错', () => {
  assert.throws(() => parseJsonlReport('not-json\n', 'a'), /a:1: 不是合法 JSON/)
  assert.throws(() => parseJsonlReport('{"case_id":"x"}\n', 'a'), /status 非 pass\|fail/)
})

test('目录输入:sessions.jsonl(JSON)优先,无则 report.md 兜底', () => {
  const dir = tmpDir()
  try {
    const withJsonl = join(dir, 'run-jsonl')
    mkdirSync(withJsonl)
    writeFileSync(join(withJsonl, 'sessions.jsonl'), jsonl(20, 20))
    const withMd = join(dir, 'run-md')
    mkdirSync(withMd)
    writeFileSync(join(withMd, 'report.md'), markdown(['rg-01', 'rg-02'], ['pass', 'pass']))

    const outcome = runDiff(withJsonl, withMd)
    assert.equal(outcome.code, 0)
    assert.equal(outcome.json.baseline.total, 20)
    assert.equal(outcome.json.compacted.total, 2)
    assert.equal(outcome.json.verdict, 'no-decay')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CLI:exit 0 / exit 1 / exit 2 与 --json 输出(spawnSync 真跑)', async () => {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const script = fileURLToPath(new URL('./diff-pass-rate.mjs', import.meta.url))
  const dir = tmpDir()
  try {
    const good = join(dir, 'good.jsonl')
    const bad = join(dir, 'bad.jsonl')
    writeFileSync(good, jsonl(20, 20))
    writeFileSync(bad, jsonl(20, 19))
    writeFileSync(join(dir, 'broken.jsonl'), 'not-json\n')

    assert.equal(spawnSync(process.execPath, [script, good, good]).status, 0)
    assert.equal(spawnSync(process.execPath, [script, good, bad]).status, 1)
    // 恰好等于阈值 5 → 过。
    assert.equal(spawnSync(process.execPath, [script, good, bad, '--threshold', '5']).status, 0)
    assert.equal(spawnSync(process.execPath, [script, good, join(dir, 'broken.jsonl')]).status, 2)
    assert.equal(spawnSync(process.execPath, [script]).status, 2)
    assert.equal(spawnSync(process.execPath, [script, good]).status, 2)
    assert.equal(spawnSync(process.execPath, [script, good, good, '--wat']).status, 2)

    const jsonRun = spawnSync(process.execPath, [script, good, bad, '--json'])
    assert.equal(jsonRun.status, 1)
    const parsed = JSON.parse(jsonRun.stdout.toString())
    assert.equal(parsed.baseline.rate, 100)
    assert.equal(parsed.compacted.rate, 95)
    assert.equal(parsed.delta, 5)
    assert.equal(parsed.threshold, 2)
    assert.equal(parsed.verdict, 'decay')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 口径指纹闸(F2 复审修复):同 pack 同 adapter 的确定性复跑 diff 恒 0 by construction,
// 「无衰减」判定形同恒真——run.json 指纹相同 → 缺省拒绝判定(退出码 3),--allow-same-caliber
// 显式放行(管线保活,输出明示门禁未武装);压缩态腿就位后指纹天然不同,门禁自动武装。

/** 造一份 run.json manifest(对齐 tools/evals/src/runner.ts 落盘面)。 */
const manifest = (fingerprint) => JSON.stringify({
  packDir: '/pack',
  adapterId: 'replay',
  startedAt: '2026-11-23T00:00:00.000Z',
  fingerprint,
}, null, 2) + '\n'

test('口径指纹:两侧 run.json 相同指纹 → 退出码 3 gate-not-armed(缺省拒绝恒真对比)', () => {
  const dir = tmpDir()
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    mkdirSync(a); mkdirSync(b)
    writeFileSync(join(a, 'sessions.jsonl'), jsonl(20, 20))
    writeFileSync(join(b, 'sessions.jsonl'), jsonl(20, 20))
    writeFileSync(join(a, 'run.json'), manifest('fp-same'))
    writeFileSync(join(b, 'run.json'), manifest('fp-same'))
    const outcome = runDiff(a, b)
    assert.equal(outcome.code, 3)
    assert.equal(outcome.json.verdict, 'gate-not-armed')
    assert.equal(outcome.json.caliber.same, true)
    assert.match(outcome.summaryText.join('\n'), /门禁未武装/)
    // --allow-same-caliber 显式放行:判定照常(0),但口径警告仍在场。
    const allowed = runDiff(a, b, { allowSameCaliber: true })
    assert.equal(allowed.code, 0)
    assert.equal(allowed.json.verdict, 'no-decay')
    assert.equal(allowed.json.caliber.same, true)
    assert.match(allowed.summaryText.join('\n'), /门禁未武装/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('口径指纹:不同指纹(真实压缩态腿)→ 照常判定;单侧缺 manifest → 指纹面不生效', () => {
  const dir = tmpDir()
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    const c = join(dir, 'c')
    mkdirSync(a); mkdirSync(b); mkdirSync(c)
    writeFileSync(join(a, 'sessions.jsonl'), jsonl(20, 20))
    writeFileSync(join(b, 'sessions.jsonl'), jsonl(20, 19))
    writeFileSync(join(c, 'sessions.jsonl'), jsonl(20, 19))
    writeFileSync(join(a, 'run.json'), manifest('fp-clean'))
    writeFileSync(join(b, 'run.json'), manifest('fp-compacted'))
    // 指纹不同 = 口径不同(压缩态真跑)→ 衰减判定照常生效。
    assert.equal(runDiff(a, b).code, 1)
    // 单侧无 run.json(旧产物/文件输入)→ 不猜,按差值判定,口径面如实登记。
    const partial = runDiff(a, c)
    assert.equal(partial.code, 1)
    assert.equal(partial.json.caliber.same, false)
    assert.match(partial.json.caliber.manifest, /run\.json/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('口径指纹:run.json 坏 JSON / 缺 fingerprint → 解析错误(不猜)', () => {
  const dir = tmpDir()
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    mkdirSync(a); mkdirSync(b)
    writeFileSync(join(a, 'sessions.jsonl'), jsonl(20, 20))
    writeFileSync(join(b, 'sessions.jsonl'), jsonl(20, 20))
    writeFileSync(join(a, 'run.json'), 'not-json\n')
    assert.throws(() => runDiff(a, b), /run\.json 不是合法 JSON/)
    writeFileSync(join(a, 'run.json'), JSON.stringify({ packDir: '/pack' }))
    assert.throws(() => runDiff(a, b), /缺 fingerprint/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CLI:同口径复跑缺省退出码 3,--allow-same-caliber 后退出码 0(spawnSync 真跑)', async () => {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const script = fileURLToPath(new URL('./diff-pass-rate.mjs', import.meta.url))
  const dir = tmpDir()
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    mkdirSync(a); mkdirSync(b)
    writeFileSync(join(a, 'sessions.jsonl'), jsonl(20, 20))
    writeFileSync(join(b, 'sessions.jsonl'), jsonl(20, 20))
    writeFileSync(join(a, 'run.json'), manifest('fp-same'))
    writeFileSync(join(b, 'run.json'), manifest('fp-same'))
    assert.equal(spawnSync(process.execPath, [script, a, b]).status, 3)
    assert.equal(spawnSync(process.execPath, [script, a, b, '--allow-same-caliber']).status, 0)
    assert.equal(spawnSync(process.execPath, [script, a, b, '--json']).status, 3)
    const parsed = JSON.parse(spawnSync(process.execPath, [script, a, b, '--json']).stdout.toString())
    assert.equal(parsed.verdict, 'gate-not-armed')
    assert.equal(parsed.caliber.same, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
