/**
 * 画像纠正预填桥(M-M3 T12-②「纠正入口落显式通道」的客户端交接面):
 * 基座面板(@eterna/panel)画像卡「纠正此项」写入待预填文本;本包会话内
 * 域 chip(同 realm 的另一 bundle)读取后经官方 inputActions.setDraft 预填
 * 会话输入——纠正必须落到事实源(用户显式「请记住:纠正…」→ source=explicit
 * → approved,18 §5 纠正回路;只改视图会在下次再生时回弹,17 §3.3-6)。
 *
 * 形态:window 级桥 + CustomEvent 通知。两个 bundle 的模块实例隔离,共享状态
 * 只能走同 realm 的 window 对象;键名/事件名常量是两包的字面契约(各自构建期
 * 内联,改动必须双侧同步)。跨页刷新后待预填丢失(不落 localStorage:预填是
 * 短生命周期意图,面板文案已提示「回到对话后发送」)。
 */

/** 待预填的画像纠正(panel 写入;chip 消费后清除)。 */
export interface MemoryCorrectionPrefill {
  /** 画像节名(「工作习惯」等;进预填文案与 chip 标签)。 */
  readonly section: string
  /** 完整预填文案(「请记住:纠正 <节名>:…」,面板组好)。 */
  readonly text: string
}

/** window 桥键(两包字面契约)。 */
export const MEMORY_CORRECTION_BRIDGE_KEY = '__eternaMemoryCorrectionPrefill'

/** 通知事件名(同 tab 实时提醒;chip 已挂载时立即收到,未挂载靠读取兜底)。 */
export const MEMORY_CORRECTION_EVENT = 'eterna-memory:correction'

/** 防御收窄(panel 写入方是本仓代码,仍按跨包边界防御)。 */
export function isMemoryCorrectionPrefill(value: unknown): value is MemoryCorrectionPrefill {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.section === 'string' && record.section.length > 0
    && typeof record.text === 'string' && record.text.length > 0
}

/** 写入待预填(panel 画像卡调用;幂等覆盖)。 */
export function setCorrectionPrefill(prefill: MemoryCorrectionPrefill): void {
  ;(window as unknown as Record<string, unknown>)[MEMORY_CORRECTION_BRIDGE_KEY] = prefill
  try {
    window.dispatchEvent(new CustomEvent(MEMORY_CORRECTION_EVENT, { detail: prefill }))
  } catch {
    // 构造器不可用(极老环境)静默:消费方仍有 mount 读取兜底
  }
}

/** 读待预填(域 chip 挂载时读取;无待预填返回 null)。 */
export function takeCorrectionPrefill(): MemoryCorrectionPrefill | null {
  const value = (window as unknown as Record<string, unknown>)[MEMORY_CORRECTION_BRIDGE_KEY]
  return isMemoryCorrectionPrefill(value) ? value : null
}

/** 清除(chip 已把文案预填进输入框后调用;消费即焚)。 */
export function clearCorrectionPrefill(): void {
  const bridge = window as unknown as Record<string, unknown>
  bridge[MEMORY_CORRECTION_BRIDGE_KEY] = null
}
