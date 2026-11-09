/**
 * @eterna/llm-doctor 浏览器半边装配:官方 `settings.models.provider-card` keyed
 * slot(slot-contract.ts:23-42——本仓之外插件向 Models 设置区加 UI 的两个正式席位
 * 之一,按 settingsNs 领取本家族每张卡片)。在 ns=llm-pi-ai 的 provider 卡片内
 * 渲染诊断区块(组件见 DoctorStrip.tsx)。
 */
import { DoctorStrip } from './DoctorStrip.tsx'
import { installDoctorStyles } from './styles.ts'
import type { ConnectionFace, DoctorClientContext, SlotsFace, SlotRegisterOptions } from './state.ts'

export const inject = ['slots', 'connection']

/**
 * 浏览器插件体:在 ns=llm-pi-ai 的每张 provider 卡片内注册诊断区块。
 * @param ctx - 浏览器插件上下文。
 * @returns 撤销函数(slot 贡献随插件 fiber 自撤)。
 */
export function apply(ctx: { slots: SlotsFace; connection: ConnectionFace }): () => void {
  installDoctorStyles()
  const callDoctor = async (
    endpoint: string,
    input: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; value?: unknown; message?: string }> => {
    // 载荷纪律:零参端点(health)传 {args:{}},带参端点(probe)才包 input——
    // 网关按 descriptor 校验 args 字段,零参方法多传 input 即拒(实测教训)。
    const payload = Object.keys(input).length > 0 ? { args: { input } } : { args: {} }
    try {
      const result = await ctx.connection.rpc.call('/api', endpoint, payload)
      if (result.ok) return { ok: true, value: result.value }
      return { ok: false, message: result.error?.message ?? result.error?.code ?? 'unknown' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  const doctorCtx: DoctorClientContext = { ...ctx, callDoctor }
  return ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: 'llm-pi-ai',
    inject: () => ({ slotCtx: doctorCtx }),
  } satisfies SlotRegisterOptions, DoctorStrip))
}
