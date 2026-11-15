#!/usr/bin/env node
/**
 * C8a 摘要模型对比 CLI:node packages/compaction/evals/run-compare.mjs
 *   [--models a,b,c] [--cases id,id] [--max-tokens n] [--out path]
 *   [--raw-json-out path] [--from-json path] [--conclusions-file path] [--no-fail]
 *
 * 实现说明:与 scripts/run-golden.mjs 同款 esbuild 打包动态 import(缓存落
 * evals/.cache/);本文件在 evals/ 内(C8a 改动白名单:packages/compaction/evals/**)。
 * 凭据运行时读 .secrets/,不进 argv/日志/报告。
 */
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')
const repoRoot = resolve(packageDir, '../..')
const cacheDir = join(packageDir, 'evals', '.cache')
const bundlePath = join(cacheDir, 'compare-entry.mjs')

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    switch (flag) {
      case '--models': args.models = argv[++index]; break
      case '--cases': args.cases = argv[++index]; break
      case '--max-tokens': args.maxTokens = Number(argv[++index]); break
      case '--out': args.out = argv[++index]; break
      case '--raw-json-out': args.rawJsonOut = argv[++index]; break
      case '--from-json': args.fromJson = argv[++index]; break
      case '--conclusions-file': args.conclusionsFile = argv[++index]; break
      case '--no-fail': args.noFail = true; break
      default: throw new Error(`unknown flag "${flag}"(支持 --models/--cases/--max-tokens/--out/--raw-json-out/--from-json/--conclusions-file/--no-fail)`)
    }
  }
  if (args.maxTokens !== undefined && (!Number.isInteger(args.maxTokens) || args.maxTokens <= 0)) {
    throw new Error('--max-tokens must be a positive integer')
  }
  return args
}

mkdirSync(cacheDir, { recursive: true })
await build({
  entryPoints: [join(packageDir, 'evals', 'compare-entry.ts')],
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
  process.stdout.write(`[run-compare] ${outcome.summary}\n`)
  process.exitCode = outcome.ok ? 0 : 1
} finally {
  rmSync(bundlePath, { force: true })
}
