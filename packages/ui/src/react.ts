/**
 * v4 共享基础件的 React 入口。
 *
 * 与根入口分开是硬约束，不是洁癖：根 `index.ts` 会被服务端插件（如
 * `@eterna/access`）导入，而宿主 Loader 是 strip-only TS，遇到 `.tsx`
 * 会在 import 阶段抛 `ERR_UNKNOWN_FILE_EXTENSION` —— 整个插件行不激活。
 * 所以任何 `.tsx` 都只能从这个**客户端专用**入口进。
 */
export {
  Badge, Beads, Button, Card, Field, IconButton, Input, Ring, StatusDot, Strip, Textarea,
} from './components.tsx'
export type {
  BadgeProps, BadgeTone, BeadProps, ButtonProps, ButtonSize, ButtonVariant, CardProps, CardTier,
  FieldProps, IconButtonProps, InputProps, RingProps, StatusDotProps, StatusState, StripProps, TextareaProps,
} from './components.tsx'

export { DECISION_INSET_VAR, DecisionLayer } from './decision-layer.tsx'
export type { DecisionLayerProps } from './decision-layer.tsx'
