/**
 * configEditor 写通道(T2.1,计划书 §6「写穿 configEditor 热生效」/测试计划 §4 T2.1):
 *
 * 写链路优先经官方 configEditor seam(@deepseek-ai/dsh-config-editor Service)写回:
 * `edit(entry, change)` = 校验 → 整行 config 经官方 yaml 序列化持久化到其 documentPath
 * (官方 getter = profileContext.patchPath;调用方 index.ts 的落点守卫在其在场且 ≠
 * 本网关 patch 落点时拒走本通道,防三处落点错位)→ `fiber.resolveConfig`
 * 热应用 + Loader 重组合——**edit 返回时重组合已完成**(无需等文件监视 HMR 的秒级
 * 防抖),这是「写回后不重启、新会话即用新文」的官方通道(llm-doctor 先例
 * packages/llm-doctor/src/index.ts:42-54,118-125;接口形态照抄;瞬态错误退避重试
 * 同先例 :186-202)。
 *
 * 保真依据(官方契约,零内核改动):cordis-plugin-loader `_resolveDisabled` 注释——
 * 「The raw node stays in the options, so write-back keeps the form」:`!!js` 表达式在
 * entry.options 上保留 `{__jsExpr}` 原节点,configEditor 写回时经其内部 visit() 还原
 * `!!js` 标量,不会 bake 进求值结果。
 *
 * 本模块边界:只声明结构子集接口 + 纯变换(条目定位 → 行 config 派生新值)。降级边界
 * 分两段(调用方 index.ts 写链路):
 * - **通道解析阶段降级直写**:服务缺席 / 行不在活跃条目 / configuration() 行不可得 /
 *   落点不一致(configEditor 持久化落点 ≠ 本网关 patch 落点)→ 走 entry-patch 直写
 *   兜底并审计记因,不炸宿主;
 * - **run 阶段失败不降级**(fail-closed 上抛 write-failed):变换定位失败(插件 id
 *   命中 0/≥2、末级 config 非对象等)与 edit 非瞬态错误——此时直写会与 Loader 内存
 *   组合漂移(seam 已按旧行 config 校验过组合树),故拒绝双轨混写,由调用方按
 *   「现值未变/已还原」处置,可刷新重试。
 */
import type { PromptRegistryEntry } from './registry.ts'

/**
 * configEditor 消费面(结构子集;测试注入同构假体——llm-doctor 同款防御形态)。
 * edit 的 change 收到「当前行 config(override 层)」须返回**整行下一版 config**
 * (官方会整行替换持久化,漏键=删键)。documentPath 为官方 Service 的 getter
 * (seam 持久化落点),结构子集中可选——在场时供落点一致性守卫直接验证。
 */
export interface ConfigEditorFace {
  entries(): { options: { id: string } }[]
  configuration(): unknown
  edit(
    entry: { options: { id: string } },
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
  /** seam 持久化落点(官方 = profileContext.patchPath;结构子集可选)。 */
  readonly documentPath?: string
}

/** configuration() 的行(防御形状:顶层数组或 {entries});override=patch 层该行 config。 */
export interface ConfigEditorRow {
  readonly entry: { options: { id: string } }
  readonly override: Record<string, unknown>
}

/**
 * 安全解析 configEditor 服务(缺席/未就绪/解析抛错 → undefined,不炸宿主;llm-doctor
 * resolveConfigEditor 同款 try/catch 防御)。configEditor 缺席时调用方走直写兜底并记录。
 */
export function resolveConfigEditor(ctx: { get(name: string): unknown }): ConfigEditorFace | undefined {
  try {
    const service = ctx.get('configEditor') as ConfigEditorFace | undefined
    if (service !== undefined && typeof service.entries === 'function' && typeof service.edit === 'function') {
      return service
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 读取 configuration() 的行清单(防御形状:数组或 {entries});llm-doctor readRows 同款。
 * 用于取写前行的 override config(verify 失败时经同一 seam 还原的基准)。
 */
export function readConfigEditorRows(editor: ConfigEditorFace): ConfigEditorRow[] {
  const raw: unknown = editor.configuration()
  const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown[] } | null | undefined)?.entries ?? []
  const out: ConfigEditorRow[] = []
  for (const item of list) {
    const row = item as { entry?: { options?: { id?: unknown } }; override?: Record<string, unknown> }
    const id = row.entry?.options?.id
    if (typeof id === 'string') out.push({ entry: { options: { id } }, override: row.override ?? {} })
  }
  return out
}

/** 插件项(config.plugins[] 的成员;防御形状)。 */
interface PluginItem {
  readonly id?: unknown
  readonly config?: unknown
}

function isPluginItem(value: unknown): value is PluginItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as PluginItem).id === 'string'
}

function plainObjectOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * 新值标量类型对齐:原值是数值(maxBytes 等)且新文本是纯整数 → 保持数值类型
 * (写回字符串会改变 config 值类型,上游插件面破坏);其余一律文本。
 */
function coerceScalarLike(oldValue: unknown, nextText: string): string | number {
  if (typeof oldValue === 'number' && /^\d+$/u.test(nextText)) return Number.parseInt(nextText, 10)
  return nextText
}

/**
 * 纯变换:注册表条目定位 → 行 config 派生下一版(T2.1 configEditor 通道的 change 函数体)。
 * - 沿 pluginPath 逐级导航预设行的插件列表(首级 = config.plugins;组行的下级列表 =
 *   组项 config 本身(序列,如 planning→plan-mode)或 config.plugins);
 * - **不可变更新**:仅重建定位路径上的容器,未触动的子树(含 `{__jsExpr}` 原节点)按引用
 *   共享——官方序列化往返原样保真;
 * - fail-closed:任一级 id 命中 0/≥2、plugins 非列表、末级 config 非对象即抛(零写入)。
 */
export function applyEntryToRowConfig(
  entry: PromptRegistryEntry,
  rowConfig: Record<string, unknown>,
  nextText: string,
): Record<string, unknown> {
  const yaml = entry.yaml
  if (yaml === undefined) {
    throw new Error(`configEditor 通道定位失败(${entry.id}):条目无 YAML 定位(整文件条目),不可经行 config 写回`)
  }
  const pluginPath = yaml.pluginPath ?? []
  if (pluginPath.length === 0) {
    return { ...rowConfig, [yaml.configKey]: coerceScalarLike(rowConfig[yaml.configKey], nextText) }
  }
  const plugins = rowConfig.plugins
  if (!Array.isArray(plugins)) {
    throw new Error(`configEditor 通道定位失败(${entry.id}):行 config.plugins 非插件列表`)
  }
  return { ...rowConfig, plugins: rewritePluginList(entry.id, plugins, pluginPath, 0, yaml.configKey, nextText) }
}

/** rewritePluginList 的递归体(沿 pluginPath 导航,返回新列表;原列表不可变)。 */
function rewritePluginList(
  entryId: string,
  list: readonly unknown[],
  pluginPath: readonly string[],
  depth: number,
  configKey: string,
  nextText: string,
): unknown[] {
  const wanted = pluginPath[depth] as string
  const hitIndexes: number[] = []
  for (let i = 0; i < list.length; i += 1) {
    if (isPluginItem(list[i]) && (list[i] as PluginItem).id === wanted) hitIndexes.push(i)
  }
  if (hitIndexes.length !== 1) {
    throw new Error(`configEditor 通道定位失败(${entryId}):插件列表内 id=${wanted} 命中 ${hitIndexes.length} 项(期望 1,fail-closed 拒写)`)
  }
  const at = hitIndexes[0] as number
  const item = list[at] as PluginItem
  if (depth === pluginPath.length - 1) {
    const config = plainObjectOf(item.config)
    if (config === undefined) {
      throw new Error(`configEditor 通道定位失败(${entryId}):插件 ${wanted} 的 config 非对象,不能承载键 ${configKey}`)
    }
    const replacement = { ...item, config: { ...config, [configKey]: coerceScalarLike(config[configKey], nextText) } }
    return [...list.slice(0, at), replacement, ...list.slice(at + 1)]
  }
  // 中间级:组行。下级列表 = 组项 config 本身(序列,dsh 组行形态)或 config.plugins。
  if (Array.isArray(item.config)) {
    const nextChild = rewritePluginList(entryId, item.config, pluginPath, depth + 1, configKey, nextText)
    return [...list.slice(0, at), { ...item, config: nextChild }, ...list.slice(at + 1)]
  }
  const nestedConfig = plainObjectOf(item.config)
  const nestedList = nestedConfig?.plugins
  if (nestedConfig !== undefined && Array.isArray(nestedList)) {
    const nextChild = rewritePluginList(entryId, nestedList, pluginPath, depth + 1, configKey, nextText)
    return [...list.slice(0, at), { ...item, config: { ...nestedConfig, plugins: nextChild } }, ...list.slice(at + 1)]
  }
  throw new Error(`configEditor 通道定位失败(${entryId}):插件 ${wanted} 无嵌套插件列表(组行 config 非序列且无 config.plugins)`)
}
