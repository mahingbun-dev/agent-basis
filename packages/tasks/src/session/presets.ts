/**
 * agent preset 声明常量(35 号 A25;34 号 §1 cordis.patch.yml 行)。
 *
 * cordis.patch.yml 两组 preset 的 config.id 单一真值:Sessions 建会话时按角色选 preset
 * (SA WORKER_PRESET/ROUTER_PRESET 同位,SA app/sessions.ts:48;本仓消费点 = Sessions 的
 * host.presets 选项,A22 接线面),preset.spec 以本常量对 YAML 做交叉钉住
 * (双侧字符串漂移即红,registry.test.ts 交叉钉住同款手法)。
 */

/** cordis.patch.yml 相对包根路径(preset.spec 的解析对象;34 §1 目录树行)。 */
export const CORDIS_PATCH_FILE = 'cordis.patch.yml'

/** orchestrator(主 Session)preset 的 config.id(cordis.patch.yml eterna-tasks-orchestrator-preset 行)。 */
export const ORCHESTRATOR_PRESET_ID = 'eterna-tasks-orchestrator'

/** worker(工单执行 Session)preset 的 config.id(cordis.patch.yml eterna-tasks-worker-preset 行)。 */
export const WORKER_PRESET_ID = 'eterna-tasks-worker'

/** 压缩组行序(28 号 §3/§4-2;stale 先于 basic 是有意的:先泄压后摘要,22 号 §4-C6)。 */
export const COMPACTION_ROW_ORDER = ['stale-tool-result-pruner', 'compaction-basic', 'command-compact', 'tool-result-pruner'] as const
