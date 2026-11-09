/**
 * ai-evo 上传用导出:golden YAML → Excel 兼容 CSV(13 号文档 §5 第 4 步)。
 *
 * 列:user_input / answer / 扩展列(id,tags,category,red_line)——与 ai-evo
 * 数据集上传的列口径对齐;answer 由终态/轨迹断言确定性派生(本地无裁判模型,
 * 创意类 rubric 留 ai-evo 平台侧 judge)。
 *
 * 依赖:直接复用 @eterna/packctl 的 golden 加载器(loadGoldenDir)——与 packctl lint
 * 同一份解析器,不另造轮子。Node >= 22.18(原生 TS strip-types,与 packctl bin 同口径)。
 *
 * 用法(仓库根):node packs/event-planning/evals/export/generate-csv.mjs [--out <csv路径>]
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadGoldenDir } from '../../../../tools/packctl/src/golden.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK_ROOT = join(HERE, '..', '..')
const DEFAULT_OUT = join(HERE, 'ai-evo-goldenset-v1.csv')

const outArg = process.argv.find(arg => arg.startsWith('--out='))
const outFlagAt = process.argv.indexOf('--out')
const outPath = outArg !== undefined
  ? outArg.slice('--out='.length)
  : (outFlagAt !== -1 ? (process.argv[outFlagAt + 1] ?? DEFAULT_OUT) : DEFAULT_OUT)

const loaded = loadGoldenDir(join(PACK_ROOT, 'evals', 'golden'), 'evals/golden')
const errors = loaded.findings.filter(f => f.severity === 'error')
if (errors.length > 0) {
  for (const f of errors) console.error(`[GOLD] ${f.path}: ${f.message}`)
  process.exit(1)
}

/** 断言 → 可读 answer 摘要(确定性,不引模型)。 */
function answerOf(golden) {
  const parts = []
  const finalState = Array.isArray(golden.final_state) ? golden.final_state : []
  for (const entry of finalState) {
    if (entry.file_assert !== undefined) {
      const file = entry.file_assert
      const cond = file.contains !== undefined
        ? `含「${String(file.contains)}」`
        : (file.not_contains !== undefined ? `不含「${String(file.not_contains)}」` : '存在')
      parts.push(`文件 ${String(file.path)} ${cond}`)
    } else if (entry.script !== undefined) {
      parts.push('终态脚本校验通过(确定性)')
    } else {
      parts.push('HTTP 终态断言通过(本地 mock)')
    }
  }
  const traj = golden.trajectory
  if (traj !== undefined) {
    if (Array.isArray(traj.approval_flow) !== true && traj.approval_flow !== undefined) {
      const flow = traj.approval_flow
      const bits = [`${String(flow.tool ?? '任意工具')} 必须触发审批`]
      if (flow.outcome !== undefined) bits.push(`结局 ${String(flow.outcome)}`)
      if (flow.not_executed === true) bits.push('被拒调用不得执行')
      parts.push(`审批红线:${bits.join('、')}`)
    }
    if (traj.must_call !== undefined && traj.must_call.length > 0) parts.push(`必调工具 ${traj.must_call.join('/')}`)
    if (traj.must_not_call !== undefined && traj.must_not_call.length > 0) parts.push(`禁调工具 ${traj.must_not_call.join('/')}`)
  }
  return parts.join(';')
}

/** RFC4180 转义 + CRLF + UTF-8 BOM(Excel 打开中文不乱码)。 */
function csvField(value) {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

const HEADER = ['user_input', 'answer', 'id', 'tags', 'category', 'red_line']
const rows = [HEADER.join(',')]
for (const golden of loaded.cases) {
  rows.push([
    csvField(golden.user_input),
    csvField(answerOf(golden)),
    csvField(golden.id),
    csvField((golden.tags ?? []).join('|')),
    csvField(golden.extra?.category ?? ''),
    csvField(golden.extra?.red_line === true ? 'true' : 'false'),
  ].join(','))
}
writeFileSync(outPath, `\uFEFF${rows.join('\r\n')}\r\n`, 'utf8')
console.log(`已导出 ${String(loaded.cases.length)} 条 → ${outPath}`)
