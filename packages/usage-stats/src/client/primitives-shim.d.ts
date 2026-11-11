/**
 * 基线外部模块 ui-primitives 的本地类型垫片(运行时由 dsh web 壳模块表注入)。
 * 只声明本插件消费的图标面:IconDataOutlineRegular 已在上游静态模块表中核对。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export const IconDataOutlineRegular: (props: { readonly size?: number | undefined }) => import('react').ReactElement
}
