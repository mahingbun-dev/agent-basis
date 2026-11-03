/**
 * dsh-evals CLI。
 *
 * 用法:
 *   dsh-evals run --pack <目录> [--subset smoke] [--case <id>]
 *                 [--adapter replay|acp] [--out <目录>]
 *                 [--provider <id>] [--model <id>] [--dsh-home <目录>]
 *                 [--python <解释器>] [--driver <脚本>]
 *
 * 退出码:0 = 全部通过(且至少一条 case);1 = 存在失败;2 = 用法/加载错误。
 */
import * as path from 'node:path'
import { runPack } from './runner.ts'

interface CliArgs {
  readonly command: string
  readonly packDir?: string | undefined
  readonly subset?: string | undefined
  readonly caseId?: string | undefined
  readonly adapter?: string | undefined
  readonly outDir?: string | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly dshHome?: string | undefined
  readonly python?: string | undefined
  readonly driver?: string | undefined
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv)
  if (parsed === undefined) {
    printUsage()
    return 2
  }
  if (parsed.command !== 'run') {
    process.stderr.write(`未知命令: ${parsed.command}\n`)
    printUsage()
    return 2
  }
  if (parsed.packDir === undefined) {
    process.stderr.write('--pack 为必填\n')
    printUsage()
    return 2
  }
  if (parsed.adapter !== undefined && parsed.adapter !== 'replay' && parsed.adapter !== 'acp') {
    process.stderr.write('--adapter 应为 replay|acp\n')
    return 2
  }
  const outDir = parsed.outDir === undefined
    ? path.join(process.cwd(), 'dsh-evals-out', `${parsed.adapter ?? 'auto'}-${timestampDir()}`)
    : path.resolve(parsed.outDir)
  const defaults: { dsh_home?: string; provider?: string; model?: string } = {}
  if (parsed.dshHome !== undefined) defaults.dsh_home = parsed.dshHome
  if (parsed.provider !== undefined) defaults.provider = parsed.provider
  if (parsed.model !== undefined) defaults.model = parsed.model
  const result = await runPack({
    packDir: parsed.packDir,
    ...(parsed.adapter === undefined ? {} : { adapterId: parsed.adapter }),
    ...(parsed.subset === undefined ? {} : { subset: parsed.subset }),
    ...(parsed.caseId === undefined ? {} : { caseId: parsed.caseId }),
    outDir,
    acpOptions: {
      ...(parsed.python === undefined ? {} : { pythonBin: parsed.python }),
      ...(parsed.driver === undefined ? {} : { driverPath: parsed.driver }),
      defaults,
    },
  })
  const total = result.results.length
  const pass = result.results.filter(item => item.status === 'pass').length
  const loadFailed = result.loadErrors.length
  process.stdout.write(`pack=${result.packDir} adapter=${result.adapterId} total=${total} pass=${pass} fail=${total - pass}\n`)
  for (const item of result.results) {
    const head = item.status === 'pass' ? 'PASS' : 'FAIL'
    const first = item.failures[0]?.message ?? ''
    process.stdout.write(`  [${head}] ${item.caseData.id} ${first === '' ? '' : `— ${first}`}\n`)
  }
  for (const error of result.loadErrors) {
    process.stdout.write(`  [SCHEMA-FAIL] ${error.file}: ${error.message}\n`)
  }
  process.stdout.write(`report: ${path.join(outDir, 'report.md')}\n`)
  process.stdout.write(`sessions: ${path.join(outDir, 'sessions.jsonl')}\n`)
  if (loadFailed > 0 && total === 0) return 2
  if (total === 0) {
    process.stderr.write('没有匹配的 case(subset/case 过滤后为空)\n')
    return 2
  }
  // schema 加载失败逐行报告(SCHEMA-FAIL)但不改退出码:subset 运行不应被未选中的坏文件拖垮;
  // 无任何 case 可跑时才以 2 退出。
  return pass === total ? 0 : 1
}

function timestampDir(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function parseArgs(argv: readonly string[]): CliArgs | undefined {
  const flags = new Map<string, string>()
  let command: string | undefined
  let index = 0
  while (index < argv.length) {
    const token = argv[index]
    if (token === undefined) return undefined
    if (!token.startsWith('--')) {
      if (command !== undefined) return undefined
      command = token
      index += 1
      continue
    }
    const eq = token.indexOf('=')
    if (eq !== -1) {
      const key = token.slice(2, eq)
      const value = token.slice(eq + 1)
      if (value.length === 0) return undefined
      flags.set(key, value)
      index += 1
      continue
    }
    const key = token.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) return undefined
    flags.set(key, value)
    index += 2
  }
  if (command === undefined) return undefined
  return {
    command,
    packDir: flags.get('pack'),
    subset: flags.get('subset'),
    caseId: flags.get('case'),
    adapter: flags.get('adapter'),
    outDir: flags.get('out'),
    provider: flags.get('provider'),
    model: flags.get('model'),
    dshHome: flags.get('dsh-home'),
    python: flags.get('python'),
    driver: flags.get('driver'),
  }
}

function printUsage(): void {
  process.stderr.write([
    '用法: dsh-evals run --pack <目录> [选项]',
    '',
    '选项:',
    '  --pack <目录>       golden pack 目录(含 evals/*.yaml;fixtures/<id>.jsonl 为回放会话)',
    '  --subset <tag>      只跑带该 tag 的 case(如 smoke)',
    '  --case <id>         只跑指定 id 的 case',
    '  --adapter <id>      强制适配器 replay|acp(缺省逐 case:golden 的 adapter 字段)',
    '  --out <目录>        产物目录(缺省 ./dsh-evals-out/<时间戳>)',
    '  --provider/--model/--dsh-home   acp 适配器透传 DSH Python SDK 配置',
    '  --python <解释器>   acp driver 的解释器(缺省 python3,或 env DSH_EVALS_PYTHON)',
    '  --driver <脚本>     acp driver 路径(缺省包内 python/dsh_eval_driver.py)',
    '',
    '退出码: 0 全部通过;1 存在失败;2 用法错误或无 case 可跑(schema 坏文件仅打印 SCHEMA-FAIL)',
    '',
  ].join('\n'))
}
