/**
 * @eterna/compaction 包根导出 = 宿主载具行(2026-11-12)。
 *
 * 为什么包根是它:client-modules 收集器(0.2.2-rc.1 lib/index.ts exactPackageSpecifier)
 * 只把 `@scope/name` 两段形式的 Loader 行名当作 dsh.client 双面包候选,三段子路径
 * 行名被静默忽略;而 client 收集又只扫宿主 Loader 条目(预设组内行不算)。
 * 压缩三行(basic/command/pruner)+admin 全在 preset 组内,设置分区 client 半边
 * 因此进不了浏览器花名册——本行以宿主 insert 挂载包根,仅为 client 半边提供
 * 宿主条目;宿主侧零职责(idle 插件),设置数据面是 preset 组内的 admin-plugin
 * (./admin-plugin),压缩引擎面是同组 basic/command/pruner。
 *
 * usage-stats 同款宿主行配方(default 导出 {name, apply})。
 */
export const name = 'eterna-compaction-client'

export default {
  name,
  apply(): () => void {
    return () => {}
  },
}
