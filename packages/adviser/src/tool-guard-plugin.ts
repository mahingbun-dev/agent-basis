/**
 * 预设内守门行的插件入口(DSH preset plugins 行)。
 *
 * `eterna-adviser` preset 的 `plugins` 列表末尾挂本包(`@eterna/adviser/tool-guard`),
 * 于是预设每被一次子会话绑定时,守门都作用在那条 scope 链上——见 `tool-guard.ts`
 * 头注(为什么不能放在 host.ts、为什么是动态 deny、为什么要异步订阅)。
 *
 * 本文件是**独立导出**(不是 preset 内的主插件):预设的 plugins 行按 name 解析,
 * 与 host 半边的 `src/index.ts` 分开导出可以让「服务面装配」与「工具面守门」
 * 各自缺席、各自降级。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createToolGuard } from './tool-guard.ts'

/** DSH bundle loader 取 default export 插件实例。 */
export default {
  name: 'eterna-adviser-tool-guard',
  // `tools` 必须显式 inject:cordis 的过滤上下文对**未声明**的服务直读会抛
  // `cannot get property "tools" without inject`(实机实测:该 throw 发生在预设
  // 挂载期,表现为 create 恒失败 preset-missing)。
  //
  // 不写 `inject: ['tools']` 而是可选形式:预设内的 `tools` 一定在(它是上游内置),
  // 但用对象形式让 cordis 在服务缺席时**等**而不是炸——参谋是增强面,不该因为
  // 宿主服务竞态把整个预设挂载拖垮。
  inject: { tools: true },
  apply(ctx: Context): () => void {
    // 结构面消费(不 import 上游类型包):预设内只能拿到宿主已就绪的服务。
    const guard = createToolGuard(ctx as unknown as Parameters<typeof createToolGuard>[0])
    return () => { guard.dispose() }
  },
}
