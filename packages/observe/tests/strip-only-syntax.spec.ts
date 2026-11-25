/**
 * strip-only 语法门禁(2026-11-25,56 号 P0 首轮真 boot 教训)。
 *
 * DSH 宿主用 Node 的 `--experimental-strip-types` 直载插件 `src/*.ts`(只擦类型、
 * 不做降级),参数属性/`enum`/`namespace`/装饰器一律 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
 * 本包此前是纯库、无人运行期 import,`signals.ts` 的 `constructor(readonly rowId, …)`
 * 一直没暴露;session-eval 首次在宿主半边 import 本包时整条链炸——行 enabled 但
 * `fiberPhase=null`(静默不激活),包级 tsc/vitest 全绿也发现不了。
 *
 * 本文件把该教训钉在库侧:扫 `src/` 全部 .ts/.tsx,命中即失败。正则写在字符串/注释
 * 里只为说明,不参与匹配。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(import.meta.dirname, '..', 'src')

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'lib' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collect(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** CSS at-rule 白名单:模板字符串里的 `@media` 不是装饰器。 */
const CSS_AT_RULES = new Set(['media', 'supports', 'import', 'charset', 'font-face', 'keyframes', 'layer'])

function offendingSyntax(line: string): string | undefined {
  const code = line.replace(/\/\/.*$/u, '')
  if (/\bconstructor\s*\(\s*(?:public|private|protected|readonly)\b/u.test(code)) return '参数属性'
  if (/^\s*(?:export\s+)?enum\s+\w+/u.test(code)) return 'enum'
  if (/^\s*(?:export\s+)?(?:declare\s+)?namespace\s+\w+/u.test(code)) return 'namespace'
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
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
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
