/**
 * system prompt 注册表实现:唯一 name(order 升序、同 order 按名序)、
 * assemble 时求值 text provider、按 section 粒度 interpolate `{{variable}}`。
 */
import type { PromptAssembleContext, PromptRegistry, PromptSection } from '@core/contracts'

/** 插值:替换 `{{name}}`;变量缺失保留原样(装配不静默改写文本)。 */
export function interpolateText(text: string, variables: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (raw, name: string) => {
    const value = variables[name]
    return value === undefined ? raw : value
  })
}

export class PromptRegistryImpl implements PromptRegistry {
  private readonly sections = new Map<string, PromptSection>()

  /** 注册 section,返回 the exact disposer;同名重复抛错(与上游语义一致)。 */
  section(section: PromptSection): () => void {
    if (typeof section.name !== 'string' || section.name.length === 0) {
      throw new TypeError('section.name 必须是非空字符串')
    }
    if (this.sections.has(section.name)) {
      throw new Error(`prompt section "${section.name}" 已注册(唯一 name 纪律)`)
    }
    this.sections.set(section.name, section)
    return () => { this.sections.delete(section.name) }
  }

  /** 组装:order 升序(同 order 按名序),逐段求值 + 按需插值,双换行连接。 */
  assemble(context: PromptAssembleContext = { variables: {} }): string {
    const ordered = [...this.sections.values()].sort((a, b) => {
      return a.order === b.order ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.order - b.order
    })
    const parts: string[] = []
    for (const section of ordered) {
      const raw = typeof section.text === 'string' ? section.text : section.text(context)
      parts.push(section.interpolate === false ? raw : interpolateText(raw, context.variables))
    }
    return parts.join('\n\n')
  }
}
