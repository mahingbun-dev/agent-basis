/**
 * dsh-client-ui-plugin-manager 的 `plugins.tab` owner props 类型面(本地类型影子)。
 *
 * 本包不依赖该插件包(不 import 运行时);客户端源只需契约类型,故以 ambient
 * module 声明承载。内容逐字对齐上游 0.2.2-rc.5
 * `lib/types/client/slot-contract.d.ts`(2026-11-20 实读):
 * - `PluginTabProps` rc.5 起 install/update/openPackage 三者均为必填;
 * - `PluginTabInstall`/`PluginTabUpdate` 为 install/update 的入参形状。
 * rc.1 时代本包页签只有 install/openPackage 两项,rc.5 新增必填 `update()`
 * —— 页签组件按本契约显式声明 props,缺失即 tsc 报错。
 */
declare module '@deepseek-ai/dsh-client-ui-plugin-manager' {
  /** 一次精确版本的安装请求(页面安装对话框按它预填确认/进度屏)。 */
  export interface PluginTabInstall {
    /** 安装 spec,如 `name@version` 或固定提交的 `git+https` URL。 */
    readonly spec: string
    /** 仅本次安装首选 registry;缺席=沿用对话框的 registry 选择。 */
    readonly registry?: string
    /** 插件显示名(已本地化)。 */
    readonly title: string
    /** 正在安装的版本。 */
    readonly version: string
  }

  /** 把已安装 bundle 更新到某个 Git 版本(页面更新对话框:失败时回装旧版)。 */
  export interface PluginTabUpdate {
    /** 已安装 bundle 的 npm 包名。 */
    readonly packageName: string
    /** 目标版本。 */
    readonly version: string
    /** 安装 `version` 的 Git spec,固定到 bundle 来源仓库目录的完整提交。 */
    readonly spec: string
  }

  /** 页签 owner props(页面把这三个能力交给贡献页签,如 Discover)。 */
  export interface PluginTabProps {
    /** 安装用户已确认的精确版本:安装对话框直接进入校验/进度屏。 */
    readonly install: (target: PluginTabInstall) => void
    /** 对 Host 标记 `update: 'git'` 的 bundle 打开更新确认(页面未列出/已有更新在跑时不打开)。 */
    readonly update: (target: PluginTabUpdate) => void
    /** 切到 Installed 页并打开 bundle 详情页(返回键回到调用页签)。 */
    readonly openPackage: (packageName: string) => void
  }
}
