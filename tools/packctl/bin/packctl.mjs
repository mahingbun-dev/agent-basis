#!/usr/bin/env node
// packctl CLI shim(纯 JS:node 不对 .mjs 做 type-stripping,类型语法只能出现在 .ts)。
// node >= 22.18 / >= 23.6 原生支持 erasable TS:直接 import ../src/cli.ts;
// 更老的 node 22.x 需要 NODE_OPTIONS=--experimental-strip-types。
import { runPack } from '../src/cli.ts'

const lines = []
const code = runPack(process.argv.slice(2), {
  cwd: process.cwd(),
  writeLine: line => lines.push(line),
})
for (const line of lines) {
  process.stdout.write(`${line}\n`)
}
process.exit(code)
