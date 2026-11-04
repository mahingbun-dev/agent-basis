/** glue 包共享常量与类型。 */

export const BASIS_GLUE_PLUGIN_NAME = 'basis-glue'

/** memory 插件配置(对齐 @basis/memory MemoryOptions 的宿主面子集)。 */
export interface MemoryPluginConfig {
  /** M1 工作区根(缺省 = agent cwd 下的 NOTES/)。 */
  readonly notesDir?: string
  /** M2 sqlite 库路径(缺省 = agent cwd 下的 .basis/memory.sqlite3)。 */
  readonly dbPath?: string
  /** 记忆索引 section 的 token 预算(缺省 500,08 号设计)。 */
  readonly indexBudgetTokens?: number
}

/** knowledge 插件配置。 */
export interface KnowledgePluginConfig {
  /** wiki 根目录(缺省 = agent cwd 下的 knowledge.wiki/)。 */
  readonly wikiDir?: string
  /** 索引 sqlite 路径(缺省 = agent cwd 下的 .basis/knowledge.sqlite3)。 */
  readonly dbPath?: string
}

/** governance 插件配置。 */
export interface GovernancePluginConfig {
  /** 规则文件路径(YAML;缺省 = agent cwd 下的 .basis/governance.rules.yml,不存在则空规则集)。 */
  readonly rulesPath?: string
}
