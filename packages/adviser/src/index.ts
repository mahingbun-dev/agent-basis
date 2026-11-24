/**
 * @eterna/adviser Host 半边插件入口(DSH bundle loader 契约)。
 *
 * 职责边界:本包只提供**进程内服务面**(`ctx.eternaAdviser`),不注册任何
 * Web/fetch/RPC 路由——铁律 T2(`packctl tenant-scan` CI 强制)。HTTP 面由
 * eterna-access 的守卫路由登记(`/access/api/adviser/*`),两端经结构面相遇。
 *
 * 装配细节见 `host.ts` 头注(冷恢复取舍、parent 恒等校验、结构面不 import)。
 * 主会话提示词纪律见 `section.ts`(P8)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { mountAdviser } from './host.ts'
import { ADVISER_SECTION_NAME, createAdviserSection } from './section.ts'

export { ADVISER_SERVICE_ID } from './host.ts'
export {
  ADVISER_DISCIPLINE_TEXT,
  ADVISER_SECTION_NAME,
  ADVISER_SECTION_ORDER,
  createAdviserSection,
} from './section.ts'
export {
  ADVISER_LABEL,
  ADVISER_MAX_PER_PARENT,
  ADVISER_PRESET_ID,
  AdviserService,
  mintAdviserSessionId,
  type AdviserDelivery,
  type AdviserFailureCode,
  type AdviserPorts,
  type AdviserSessionView,
} from './service.ts'

/** 宿主 system-prompt 服务的最小消费面(结构面,不 import 上游类型包)。 */
interface SystemPromptFace {
  section(section: unknown): () => void
}

/** DSH bundle loader 取 default export 插件实例(对齐 glue 插件形态)。 */
export default {
  name: 'eterna-adviser',
  apply(ctx: Context): () => void {
    // P8:主会话提示词纪律。走 `ctx.systemPrompt.section` —— 本仓装配期文本的
    // 唯一合法入口(memory:index 与 tasks 的 [active-tickets] 同一 seam)。
    // 服务缺席或注册失败一律降级:少一条纪律不该让参谋整体不可用。
    let disposeSection: (() => void) | undefined
    try {
      const systemPrompt = (ctx as unknown as { readonly systemPrompt?: SystemPromptFace }).systemPrompt
      if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
        disposeSection = systemPrompt.section(createAdviserSection())
      }
    } catch {
      // 装配期文本缺席 → 主会话不知道参谋存在,但面板与投递照常工作。
      disposeSection = undefined
    }

    try {
      const disposeService = mountAdviser(ctx)
      return () => {
        disposeService()
        disposeSection?.()
      }
    } catch {
      // 装配失败只降级(服务缺席 → access 端点 503 fail-closed),不炸整个 profile:
      // 参谋是增强面,不该因宿主服务竞态把会话主流程拖垮。
      disposeSection?.()
      return () => { /* 未装成,无资源需要撤销 */ }
    }
  },
}

/** 供门禁与文档断言:本插件注册的提示词 section 名。 */
export const PROMPT_SECTION_NAME = ADVISER_SECTION_NAME
