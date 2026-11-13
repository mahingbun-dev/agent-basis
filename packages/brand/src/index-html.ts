/**
 * 服务端品牌面改写纯函数(index.html / manifest / 模型侧提示词)。
 *
 * 为什么必须服务端做:浏览器半边的 MutationObserver 只能改「已启动页面」的
 * 文本;刷新瞬间浏览器渲染的是服务端原始 HTML——`<title>DeepSeek Harness</title>`
 * 在 boot 脚本跑起来之前就已经画到标题栏(2026-11-13 生产容器实测:带 token
 * 取回的 index 原文即上游硬编码标题)。manifest 更彻底:它是静态文件,不经过
 * 文档 DOM,客户端观察器永远看不到。
 *
 * 替换纪律(本模块唯一事实源):
 * - 只改**品牌文案**(产品名/身份句/文件策略句),绝不改**真实标识符**——
 *   `$DSH_HOME`、`DSH_PROFILE_DIR`、`window.__DSH_BOOT__`、`@deepseek-ai/dsh-*`
 *   包名、`dsh` 命令名、`dsh --profile` 等都是运行时契约,改了即跑不起来
 *   (2026-11-09 技能 fork 曾把它们一并替换成 `$EternaAgent_HOME` 等,文档失效)。
 * - 幂等:重复应用结果不变(tapIndex 会在每次 index 渲染时执行)。
 */

/** 上游产品名(ui-layout productTitle / index.html / 插件描述共用的字面量)。 */
export const UPSTREAM_PRODUCT = 'DeepSeek Harness'

/** 品牌英文名(与浏览器半边 state.ts BRAND.full 同值;此处不跨半边 import,
 * 宿主侧产物要能在无 DOM 的 node 环境独立装载)。 */
export const BRAND_NAME = 'EternaAgent'

/** 模型侧身份句:上游 system-prompt 固定开场白(harness:identity, order −1000)。 */
export const UPSTREAM_IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'

/** 模型侧文件策略句前缀(上游 sandbox-policy 运行时上下文,sandbox:policy)。 */
export const UPSTREAM_FILE_POLICY = 'Current DSH file policy:'

/** 模型侧源码检出句(上游 harness-dev-context,harness:source 段与上下文)。 */
export const UPSTREAM_CHECKOUT = 'DeepSeek Harness implementation checkout'

/** 模型侧 Web GUI 句(上游 harness-dev-context,app:web-surface 段与上下文)。 */
export const UPSTREAM_WEB_GUI = 'DeepSeek Harness Web GUI'

/** 导航栏/插件卡片等处只出现缩写的情形(本地构建徽标、PWA short_name)。 */
export const UPSTREAM_SHORT_NAME = 'DSH'

/** 文案替换表(顺序敏感:长串在前,避免 `DeepSeek Harness` 被子串规则先吃掉)。 */
const TEXT_REPLACEMENTS: readonly (readonly [string, string])[] = [
  [UPSTREAM_CHECKOUT, `${BRAND_NAME} implementation checkout`],
  [UPSTREAM_WEB_GUI, `${BRAND_NAME} Web GUI`],
  [UPSTREAM_IDENTITY, `You are an AI agent powered by ${BRAND_NAME}.`],
  [UPSTREAM_FILE_POLICY, `Current ${BRAND_NAME} file policy:`],
  [UPSTREAM_PRODUCT, BRAND_NAME],
]

/**
 * 文案级替换(产品名 + 模型侧四类身份句)。
 *
 * `DSH` 单独出现时**不替换**:它在上游文本里几乎总是真实标识符的一部分
 * (`DSH_HOME`、`DSH_PROFILE_DIR`、`__DSH_BOOT__`、`DSH_SESSION_ID`、`DSH_FILE_POLICY`
 * 环境变量族)。只有明确是品牌展示位的短名(本地构建徽标 / PWA short_name)
 * 由调用方显式传入替换。
 *
 * @param text - 任意上游文案(index.html / manifest / 提示词段落)。
 * @returns 品牌化后的文本;无命中时原样返回(便于调用方做脏检查)。
 */
export function rebrandText(text: string): string {
  let out = text
  for (const [from, to] of TEXT_REPLACEMENTS) {
    if (out.includes(from)) out = out.split(from).join(to)
  }
  return out
}

/** 已改写判定的快速探针(boot 期审计日志用)。 */
export function needsRebrand(text: string): boolean {
  return TEXT_REPLACEMENTS.some(([from]) => text.includes(from))
}

/**
 * index.html 改写:标题、apple 设备短名,以及 HTML 里的品牌文案。
 *
 * 只碰 `<title>` 与 meta 短名两处结构化标记,其余走文案表——避免误改
 * 脚本/预加载清单里的包名(它们的 specifier 含 `@deepseek-ai/...`,不在替换表内)。
 *
 * @param html - 上游 dsh-web-frontend 的原始 index.html。
 * @returns 品牌化后的 HTML(幂等)。
 */
export function rebrandIndexHtml(html: string): string {
  let out = rebrandText(html)
  out = out.replace(/<title>([^<]*)<\/title>/i, (_match, title: string) =>
    `<title>${rebrandText(title)}</title>`)
  out = out.replace(
    /(<meta name="apple-mobile-web-app-title" content=")([^"]*)(")/i,
    (_match, pre: string, value: string, post: string) =>
      `${pre}${value === UPSTREAM_SHORT_NAME ? BRAND_NAME : rebrandText(value)}${post}`,
  )
  return out
}

/**
 * manifest.webmanifest 改写:name/short_name 与描述文案。
 *
 * manifest 是静态文件(不经文档 DOM),只能由服务端在响应时改写;解析失败
 * (上游格式漂移)时原样返回,绝不阻断 PWA 资源。
 *
 * @param body - 原始 manifest JSON 文本。
 * @returns 品牌化后的 JSON 文本(两空格缩进,与上游一致),或原文。
 */
export function rebrandManifest(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body
  const manifest = { ...(parsed as Record<string, unknown>) }
  if (typeof manifest['name'] === 'string') manifest['name'] = rebrandText(manifest['name'])
  if (manifest['short_name'] === UPSTREAM_SHORT_NAME) manifest['short_name'] = BRAND_NAME
  else if (typeof manifest['short_name'] === 'string') manifest['short_name'] = rebrandText(manifest['short_name'])
  if (typeof manifest['description'] === 'string') manifest['description'] = rebrandText(manifest['description'])
  return `${JSON.stringify(manifest, void 0, 2)}\n`
}
