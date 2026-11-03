#!/usr/bin/env node
// dsh-evals CLI 入口:经 Node 24 原生 type-stripping 直接执行 src/cli.ts
// (engines: node >=22;--experimental-strip-types 在 22.6+ 可用,24 起默认开启)。
// 该薄入口不承载逻辑,便于 monorepo 内直接消费 TS 源(与 exports "." 对齐)。
import { main } from '../src/cli.ts'

const code = await main(process.argv.slice(2))
process.exit(code)
