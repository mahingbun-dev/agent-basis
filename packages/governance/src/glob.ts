/**
 * 最小 glob 匹配:规则引擎的 tool 名与 egress 白名单共用。
 * 语义:`*` 匹配任意长度任意字符,`?` 匹配单个字符,其余字符按字面量;整串锚定。
 * DSH 工具名(mcp__server__tool、web_fetch 等)不含需要 `**` 跨段的场景,故不实现分段语义。
 */

/** 把 glob 串编译为锚定的正则(缓存见 matchGlob)。 */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (const ch of glob) {
    if (ch === '*') {
      source += '.*'
    } else if (ch === '?') {
      source += '.'
    } else {
      source += escapeRegExpChar(ch)
    }
  }
  return new RegExp(`^${source}$`, 'u')
}

function escapeRegExpChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/u.test(ch) ? `\\${ch}` : ch
}

const cache = new Map<string, RegExp>()

/** name 是否命中单个 glob。结果按 glob 串缓存(策略文件在热路径上反复求值)。 */
export function matchGlob(name: string, glob: string): boolean {
  let re = cache.get(glob)
  if (re === undefined) {
    re = globToRegExp(glob)
    cache.set(glob, re)
  }
  return re.test(name)
}

/** name 是否命中 glob 列表中的任意一个(空列表 = 不命中)。 */
export function matchAnyGlob(name: string, globs: readonly string[]): boolean {
  return globs.some(glob => matchGlob(name, glob))
}
