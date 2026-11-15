/**
 * 画像纠正预填桥——@eterna/panel 侧的写入半边(M-M3 T12-②「纠正入口落显式通道」)。
 *
 * 契约:与 @eterna/memory 浏览器半边(src/client/correction.ts)的字面真值互为
 * 镜像(两包构建期各自内联,跨包 import 会把 memory 的客户端闭包工件拖进面板
 * bundle,不可取)。改动任何一侧常量必须同步另一侧(memory 包
 * tests/client-settings.spec.ts 钉住字面值,此处一致)。
 *
 * 语义:面板画像卡「纠正此项」写入待预填文本;会话输入行的域 chip(memory 半边)
 * 读取后经官方 inputActions.setDraft 预填——用户回车发送「请记住:纠正 <节名>:…」
 * → source=explicit → approved(18 §5 纠正回路:纠画像必须落到事实源,17 §3.3-6)。
 */

/** 待预填的画像纠正(画像卡写入;memory 域 chip 消费后清除)。 */
export interface MemoryCorrectionPrefill {
  /** 画像节名(「工作习惯」等)。 */
  readonly section: string
  /** 完整预填文案(「请记住:纠正 <节名>:…」)。 */
  readonly text: string
}

/** window 桥键(与 memory 半边字面契约)。 */
export const MEMORY_CORRECTION_BRIDGE_KEY = '__eternaMemoryCorrectionPrefill'

/** 通知事件名(同 tab 实时提醒)。 */
export const MEMORY_CORRECTION_EVENT = 'eterna-memory:correction'

/** 画像纠正预填文案模板(19 号 §5-T12.2 原文:「请记住:纠正 <节名>:…」)。 */
export function correctionPrefillText(section: string): string {
  return `请记住:纠正 ${section}:`
}

/** 写入待预填(画像卡「纠正此项」;幂等覆盖)+ 同 tab 事件通知。 */
export function setCorrectionPrefill(prefill: MemoryCorrectionPrefill): void {
  ;(window as unknown as Record<string, unknown>)[MEMORY_CORRECTION_BRIDGE_KEY] = prefill
  try {
    window.dispatchEvent(new CustomEvent(MEMORY_CORRECTION_EVENT, { detail: prefill }))
  } catch {
    // 构造器不可用(极老环境)静默:消费方仍有 mount 读取兜底
  }
}
