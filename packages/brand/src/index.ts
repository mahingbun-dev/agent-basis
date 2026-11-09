/**
 * @eterna/brand Host 半边:品牌面替换哨兵(纯装配,无宿主服务)。
 * 品牌实现在浏览器半边(src/client):tab 标题监听、favicon 换装、侧栏 badge 覆写。
 * 装载 = 挂载集 insert 行 `- id: eterna-brand, name: '@eterna/brand'`(@eterna/panel
 * 同款双面配方;dsh.client 声明使 lib/client.js 进浏览器花名册)。
 */

export interface BrandPluginConfig {
  /** boot 后延迟(毫秒;默认 0,纯客户端注册无启动成本)。 */
  readonly initialDelayMs?: number
}

/** 插件工厂(bundle loader 取 default export 实例;apply 返回总 disposer)。 */
export function defineBrandPlugin(_config: BrandPluginConfig = {}) {
  return {
    name: 'eterna-brand',
    apply(): () => void {
      // 宿主侧无行为:品牌替换全部发生在浏览器半边。
      return () => undefined
    },
  }
}

/** DSH bundle loader 取 default export 插件实例(对齐 panel/glue 插件形态)。 */
export default defineBrandPlugin()
