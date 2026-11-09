/** ui-primitives 本地类型面(基线模块;只声明本包消费的组件)。 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** 官方按钮原子(variant 走 --dsw-alias-button-* 令牌族)。 */
  export const Button: (props: {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    size?: 'md' | 'sm'
    disabled?: boolean
    title?: string
    onClick?: (event: unknown) => void
    children?: unknown
  }) => import('react').ReactElement | null
}
