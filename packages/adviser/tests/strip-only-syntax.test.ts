/**
 * strip-only 语法门禁(2026-11-24)。
 *
 * ## 为什么需要这个测试
 * DSH 用 Node 的 `--experimental-strip-types` 直接加载插件的 `src/*.ts`——它只
 * **擦除**类型标注,**不做类型到运行时的降级**。因此以下 TypeScript 语法一律
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`,导致整个插件在真实运行时**静默装载失败**
 * (只留一行 warning),而 **vitest 会先编译,单测完全发现不了**:
 *
 * - 参数属性 `constructor(private readonly x: T)`
 * - `enum`(需运行时对象)
 * - `namespace`(需运行时作用域)
 * - 装饰器(TypeScript 装饰器糖)
 *
 * 这个死法在 2026-11-24 的实机 E2E 里被撞到一次(`AdviserService` 的
 * `constructor(private readonly ports)`),代价是「单测 38 个全绿但插件根本没装起来」。
 * 本文件把该教训钉成门禁:**扫全包 src/ 的 .ts/.tsx**,命中即失败。
 *
 * 注意:本文件自己也是 .ts,故正则必须**在字符串里转义**,不能让它匹配到自己。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(import.meta.dirname, '..', 'src')

/** 递归收集 .ts/.tsx 源文件(跳 lib/dist/node_modules)。 */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'lib' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collect(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * 逐行判定是否含 strip-only 不兼容语法。
 * 注释里的示例不算(约定:禁用写法只出现在注释里时必须带「不得」/「禁止」等说明词,
 * 而这里用「提取失败」而非精确匹配,故额外剔除行内注释部分)。
 */
/** CSS at-rule 白名单:模板字符串里的 `@media` 不是装饰器。 */
const CSS_AT_RULES = new Set([
  'media', 'supports', 'import', 'charset', 'font-face', 'keyframes', 'layer',
  'container', 'page', 'property', 'scope', 'starting-style', 'namespace',
])

function offendingSyntax(line: string): string | undefined {
  // 去掉 // 行注释(简单口径:本仓注释里的禁用示例都在行首 // 之后)
  const code = line.replace(/\/\/.*$/u, '')
  if (/\bconstructor\s*\(\s*(?:public|private|protected|readonly)\b/u.test(code)) return '参数属性'
  if (/^\s*(?:export\s+)?enum\s+\w+/u.test(code)) return 'enum'
  if (/^\s*(?:export\s+)?(?:declare\s+)?namespace\s+\w+/u.test(code)) return 'namespace'
  // 装饰器:@ 后跟标识符,**排除 CSS at-rule**(本包 styles.ts 里的 `@media`
  // 是模板字符串内容,不是装饰器——首版门禁在此误报过一次)。
  const decorator = /^\s*@([A-Za-z_$][\w$]*)\s*(?:\(|$)/u.exec(code)
  if (decorator !== null && !CSS_AT_RULES.has(decorator[1] ?? '')) return '装饰器'
  return undefined
}

describe('strip-only 语法门禁(DSH 直接加载 src/*.ts,不编译)', () => {
  it('src/ 下无参数属性 / enum / namespace / 装饰器', () => {
    const files = collect(SRC_ROOT)
    expect(files.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      for (const [index, line] of lines.entries()) {
        const kind = offendingSyntax(line)
        if (kind !== undefined) {
          violations.push(`${file.slice(SRC_ROOT.length + 1)}:${index + 1} ${kind} — ${line.trim()}`)
        }
      }
    }
    expect(violations, `strip-only 不兼容语法(会 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX):\n${violations.join('\n')}`)
      .toEqual([])
  })
})
