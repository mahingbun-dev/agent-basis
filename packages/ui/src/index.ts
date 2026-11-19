/**
 * Eterna 统一设计系统底座导出面（服务端安全）。
 *
 * **本文件只能导出纯 .ts**：DSH 宿主 Loader 是 strip-only TS，遇到 `.tsx`
 * 会在 import 阶段直接抛 `ERR_UNKNOWN_FILE_EXTENSION`（实测：access 插件
 * 因此整行 `enabled/no-fiber`，G1-1 真启动门禁红）。
 *
 * - 令牌与注入器 → 这里（服务端也用得到）。
 * - React 基础件（Button/Card/Ring/DecisionLayer…）→ `@eterna/ui/react`。
 * - 图标 → `@eterna/ui/icons`（React）/ `@eterna/ui/icon-data`（字符串）。
 */
export { WEBFLOW_TOKENS_CSS, DSH_BRIDGE_CSS, injectDesignTokens } from './tokens.ts'
export { COMPONENT_CSS } from './components-css.ts'
