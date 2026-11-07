/**
 * 基线外部模块 ui-primitives 的本地类型垫片:运行时由 dsh web 壳的模块表
 * (PLATFORM_MODULES 种子)注入,不在本仓库安装;esbuild 构建时列为 external。
 * 只声明本插件消费的图标组件面(运行时导出面已在 dsh-web-frontend dist 内核对:
 * IconListPenOutlineRegular / IconWorkspaceTreeOutlineRegular 均在
 * @deepseek-ai/dsh-client-ui-primitives 静态模块表中)。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** 产品图标组件(尺寸边长 px;结构面对齐 ui-primitives 的图标导出)。 */
  export const IconListPenOutlineRegular: (props: { readonly size?: number | undefined }) => import('react').ReactElement
  export const IconWorkspaceTreeOutlineRegular: (props: { readonly size?: number | undefined }) => import('react').ReactElement
}
