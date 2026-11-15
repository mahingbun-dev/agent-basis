#!/usr/bin/env node
/**
 * golden 评估 CLI(C4):node packages/compaction/scripts/run-golden.mjs
 *   [--model <model>] [--case <id>] [--max-tokens <n>] [--out <path>] [--no-fail]
 *   [--judge] [--judge-model <model>]
 *
 * 实现说明:评估逻辑在 evals/*.ts(与 vitest 共用同一 runner/score 面),但
 * src/basic/summarizer.ts 含 TS 参数属性,node 的 strip-only 类型擦除不能直载,
 * 故用本包 devDep 的 esbuild 把 evals/script-entry.ts 打包成临时 mjs 再动态
 * import(照 scripts/build-client.mjs 的 esbuild 先例;缓存落 evals/.cache/)。
 *
 * 凭据:运行时读 <repoRoot>/.secrets/litellm-base-url.txt 与 litellm-master-key.txt
 * (gitignored);不写 argv/日志/报告。默认模型 deepseek-flash,max_tokens 8192
 * (网关侧 reasoning 模型会先烧 reasoning token,预算给足,实测 2026-11-13)。
 */
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')
const repoRoot = resolve(packageDir, '../..')
const cacheDir = join(packageDir, 'evals', '.cache')
const bundlePath = join(cacheDir, 'golden-entry.mjs')

function parseArgs(argv) {
  const args = { maxTokens: undefined, noFail: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    switch (flag) {
      case '--model': args.model = argv[++index]; break
      case '--case': args.caseId = argv[++index]; break
      case '--max-tokens': args.maxTokens = Number(argv[++index]); break
      case '--out': args.out = argv[++index]; break
      case '--no-fail': args.noFail = true; break
      case '--judge': args.judge = true; break
      case '--judge-model': args.judgeModel = argv[++index]; break
      default: throw new Error(`unknown flag "${flag}"(支持 --model/--case/--max-tokens/--out/--no-fail/--judge/--judge-model)`)
    }
  }
  if (args.maxTokens !== undefined && (!Number.isInteger(args.maxTokens) || args.maxTokens <= 0)) {
    throw new Error('--max-tokens must be a positive integer')
  }
  return args
}

mkdirSync(cacheDir, { recursive: true })
await build({
  entryPoints: [join(packageDir, 'evals', 'script-entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // node_modules 运行时解析(工作区 deps),不打进包。
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'silent',
})

const { main } = await import(pathToFileURL(bundlePath))
try {
  const outcome = await main({ repoRoot, ...parseArgs(process.argv.slice(2)) })
  process.stdout.write(`[run-golden] ${outcome.summary}\n`)
  process.exitCode = outcome.ok ? 0 : 1
} finally {
  rmSync(bundlePath, { force: true })
}
