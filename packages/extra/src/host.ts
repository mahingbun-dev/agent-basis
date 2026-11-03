/**
 * DSH 宿主 seam 适配:把真实 dsh/cordis Context 适配为本包各模块的宿主面。
 *
 * 与 @basis/memory dshHost 同款纪律:适配是组合层唯一需要的宿主形态;
 * 本包策略层只认结构面(ToolGateHost),不 import 运行时服务。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolGateHost } from './reviewer-preset.ts'

/**
 * reviewer 工具门宿主:`ctx.tools.restrict(filter)` 的直通。
 * 注意 dsh 约定(packages/core/tools/README.md「Restrict tools per agent」):
 * restrict 需要 agent 作用域(全局遮罩会被 dsh 拒绝)——组合层应以
 * agent.ctx / preset 作用域的 ctx 调用,这里不做二次防御(dsh 自身
 * fail-loud,错误信息即指引)。
 */
export function dshToolGateHost(ctx: Context): ToolGateHost {
  return {
    restrict: filter => ctx.tools.restrict(filter),
  }
}
