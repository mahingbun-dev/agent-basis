#!/usr/bin/env node
// basis CLI 入口:仓库内直接 `node core/runtime/bin/basis.mjs <cmd>`,或经 pnpm up/chat。
// bin 不写逻辑——全部在 src/cli.ts(可测的 runBasis 纯编排)。
import { runCliMain } from '../src/cli.ts'

runCliMain(process.argv.slice(2)).then((code) => {
  process.exit(code)
}).catch((error) => {
  console.error(error)
  process.exit(2)
})
