/**
 * class-docs 纪律扫描(35 号 A27;34 §4-A 承接表「class-docs.spec.ts → 同规则扫 src/」;
 * 24 号 §8.1-6「模型面 drift 测试」采纳为工程纪律)。
 *
 * 语义自 SA tests/class-docs.spec.ts 整承接重写:src/ 下每个 class 声明都须有紧邻其前的
 * JSDoc 块(`/** … *`+`/`。扫描规则与 SA 逐字同构——递归收集 .ts/.tsx、正则识别
 * (export/default/abstract) class、向前回溯最近一个 `/**` 且其 `*``/` 恰在声明前)。
 * 35 号 A3 门禁「verify 含 class-docs 纪律扫描」由此文件承担(包级 verify 的 vitest run 收它)。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

it('src/ 下每个 class 声明都有紧邻其前的 JSDoc 块(24 号 §8.1-6 工程纪律;34 §4-A class-docs 行)', () => {
  const undocumented = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(path => /\.tsx?$/.test(path)).flatMap((path) => {
    const text = readFileSync(join(SRC, path), 'utf8')
    return [...text.matchAll(/^[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm)].flatMap((match) => {
      const before = text.slice(0, match.index).trimEnd()
      const start = before.lastIndexOf('/**')
      return start >= 0 && before.indexOf('*/', start) === before.length - 2 ? [] : [`src/${path}: ${match[1]}`]
    })
  })
  expect(undocumented).toEqual([])
})
