/**
 * 浏览器半边文案规则(纯函数,零 react/DOM 依赖 → 单测可直连)。
 *
 * 与 Host 半边 index-html.ts 同一纪律:只改品牌文案,绝不动运行时标识符。
 * 这里额外承担上游**插件描述**的品牌化(插件页 title/desc 由 locale 字典渲染,
 * 是 DOM 文本节点,走本规则):`DSH 环境变量` 这类品牌形容用法换掉,而
 * `dsh-shell-env`/`deepseek-flash` 等真实包名与模型名原样保留。
 */
import { BRAND } from './state.ts'

/** 文案替换规则(字符串=精确子串;正则=词位限定;模型名 deepseek-flash 不在图内)。 */
export const TEXT_MAP: readonly (readonly [string | RegExp, string])[] = [
  ['DeepSeek Harness', BRAND.full],
  [BRAND.upstreamBadge[0], BRAND.badge.zh],
  [BRAND.upstreamBadge[1], BRAND.badge.en],
  ['探索未至之境', '方寸灵台，运筹万里'],
  // 裸 DSH 只按独立词位替换。`$DSH_HOME`、`DSH_PROFILE_DIR`、`__DSH_BOOT__`
  // 是运行时标识符(设置页会直接展示 `$DSH_HOME/.env` 真实路径),旧版按子串
  // 替换会把路径改成不存在的 `$EternaAgent_HOME`(2026-11-13 实测)。`_` 属
  // 单词字符,`\bDSH\b` 天然不命中这族标识符。
  [/\bDSH\b/g, BRAND.full],
  // 上游营销徽章短语的小写形态(badge 技能插件描述:「powered by dsh」)。
  // 必须整短语匹配:裸小写 `dsh` 不能按词位替换——它在描述里还充当真实包名
  // (dsh-base / dsh-headless / dsh-sdk-app / dsh-llm-deepseek),`\bdsh\b` 会
  // 把包名一起吃掉变成错误陈述。整短语精确匹配天然不碰这些包名。
  ['powered by dsh', `powered by ${BRAND.full}`],
  ['powered_by-dsh', `powered_by-${BRAND.full}`],
  ['Powered by DSH', `Powered by ${BRAND.full}`],
  // 预览版痕迹清除(用户 2026-11-09:不希望有);长短语在前防子串抢先。
  // 注意:「预览版」命中的文本节点由 hidePreviewChip 整元素隐藏(只清文字会
  // 留下看不见的空样式块——hero 右上角的可疑残影,2026-11-09 用户实测)。
  ['预览版说明', ''],
]

/** 规则命中探针(带 g 的正则会残留 lastIndex,每次复位避免跨节点漏命中)。 */
function ruleHit(from: string | RegExp, text: string): boolean {
  if (typeof from === 'string') return text.includes(from)
  from.lastIndex = 0
  return from.test(text)
}

/** 单条规则改写(string 走全量 split/join,正则走 replace)。 */
function applyRule(from: string | RegExp, to: string, text: string): string {
  if (typeof from === 'string') return text.split(from).join(to)
  from.lastIndex = 0
  return text.replace(from, to)
}

/**
 * 是否有任一规则命中(观察器过滤用:未命中的节点不进入改写路径)。
 *
 * @param text - 待检文案。
 * @returns 命中任一品牌规则为 true。
 */
export function hasBrandText(text: string): boolean {
  return TEXT_MAP.some(([from]) => ruleHit(from, text))
}

/**
 * 全量映射改写(所有 TEXT_MAP 条目依序替换)。
 *
 * @param text - 任意 UI 文案(文本节点/ARIA 属性/插件描述)。
 * @returns 品牌化文本;无命中时逐字返回(调用方据此做脏检查,避免观察器自激)。
 */
export function rebrandUiText(text: string): string {
  for (const [from, to] of TEXT_MAP) {
    if (ruleHit(from, text)) text = applyRule(from, to, text)
  }
  return text
}
