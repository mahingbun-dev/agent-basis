/**
 * 设置壳分区跳转（原生扩展点，不自建导航）。
 *
 * ui-settings-general 把设置壳 store 钉在 `sidebar.settings` 席位的单例上
 * （index.ts:210-212 `create: () => shellInstance`）；其 actions.openSection(id)
 * 语义 =「切换分区 + 打开面板」，即上游给 onboarding 协调器用的同一动作。
 * 模型抽屉（'models'）与 MCP「全局」（'plugins'，内置插件页）共用此实现。
 */
export interface SettingsSeatSource {
  entries?(slot: string): readonly { readonly store?: unknown }[]
}

/** 打开指定设置分区；壳未注册/结构变化 → false，由调用方提示而非静默。 */
export function openSettingsSection(seats: SettingsSeatSource, id: string): boolean {
  try {
    const seated = seats.entries?.('sidebar.settings') ?? []
    for (const entry of seated) {
      const handle = entry.store as { create?(): { actions?: { openSection?(id: string): void } } } | undefined
      const actions = handle?.create?.().actions
      if (typeof actions?.openSection === 'function') {
        actions.openSection(id)
        return true
      }
    }
  } catch { /* 座位结构变化:降级为 false,由调用方提示 */ }
  return false
}
