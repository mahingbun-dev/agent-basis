/** 设置分区文案绑定:由 apply 的 locale.bind(NS) 注入,组件不自行拼字典。 */
export type Translate = (key: string) => string
