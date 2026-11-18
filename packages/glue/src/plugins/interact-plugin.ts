/**
 * interact 插件(39 号 §3-E8 装配形态):把 @eterna/interact 的 hitl 分档/提问合并/
 * 负信号总线装配为 ctx.interact 服务 —— provide('interact', createInteract 产物)。
 *
 * 装配面(governance-plugin 先例,name/apply + 返回配逆闭包;无静态 inject——本插件
 * 不消费任何宿主服务面,装上即可用):
 * - hitl.yaml 装载:config.hitlPath(缺省 = agent cwd 下的 .eterna/hitl.yaml,
 *   DSH_HOME 语义 `.eterna/` 缺省约定,对齐 governance.rules.yml 的加载姿势);
 *   文件存在但非法 = InteractConfigError 装载即抛(fail-closed,与 governance/egress
 *   规则文件「语法非法即抛」同口径);文件缺席 = 内置缺省策略(见 DEFAULT_HITL_YAML),
 *   不把「未部署分档表」变成 boot 失败。
 * - 服务:`ctx.provide(INTERACT_PLUGIN_SERVICE_ID='interact', interact)` ——
 *   hitl(HitlPolicy 分档裁决)+ presetArtifact(R0-R3→permission-presets 产物)+
 *   ask(TurnQuestionMerger 实例,同 turn 提问合并)+ signals(ApprovalSignalBus
 *   负信号总线,observe 经它订阅/拉取)+ gradeFor/buildApprovalCard/cardToQuestionItems
 *   便捷入口(interact index.ts「注册表 + INTERACT_SERVICE_ID 唯一 ID」的对外形态,
 *   id 溯源 '@eterna/interact')。
 * - 负信号总线挂接:总线随服务在场,消费侧(ctx 属性读取/ctx.get)经
 *   interact.signals 订阅(subscribe)或拉取快照(recent);发布面 recordOutcome/
 *   recordModification 由组合层在审批应答/产出改写处置点调用(negative.ts 头注的
 *   既定接线位)——诚实边界:unavailable/cancelled/allowed-once 不是负信号,
 *   该翻译纪律在总线内钉死(negative.ts:107-110),本插件不另造发布路径。
 *
 * 配逆 = disposeInteract()(interact 包钉死的组合层职责:flush 未发提问卡 +
 * 清空负信号快照,静默丢弃不算 flush)→ 撤服务 provide。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createInteract, disposeInteract } from '@eterna/interact'
import type { Interact } from '@eterna/interact'
import type { InteractPluginConfig } from '../types.ts'

export const ETERNA_INTERACT_PLUGIN_NAME = 'eterna-interact'

/** 本插件 provide 用的服务名(ctx 属性名即 provide 名,39 号 E8「provide ctx.interact」)。 */
export const INTERACT_PLUGIN_SERVICE_ID = 'interact'

/**
 * hitl.yaml 缺席时的内置缺省策略(实现裁量,39 号 §9-1 键形裁决前的确定性缺省):
 * default_grade R2 = 未命中规则的动作必须走人(hitl.ts:104-106 fail-closed 纪律的
 * 最保守取值);on_no_answer 缺省 suspend(hitl.ts:120)。文档缺席 ≠ 放行漏洞:
 * 该形态恰是「全部动作需确认、无人应答挂起非失败」的封闭姿态。
 */
export const DEFAULT_HITL_YAML = 'default_grade: R2\non_no_answer: suspend\nrules: []\n'

export function defineInteractPlugin(config: InteractPluginConfig = {}) {
  return {
    name: ETERNA_INTERACT_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      // hitlYaml 显式喂入 > 文件 > 内置缺省(三级来源,优先级递减;来源只影响数据,
      // 校验器是唯一权威——createInteract 内部统一走 HitlPolicy.parse fail-closed 校验)
      const hitlYaml = config.hitlYaml ?? readHitlYaml(config.hitlPath ?? join(process.cwd(), '.eterna/hitl.yaml'))
      const interact: Interact = createInteract({
        hitlYaml,
        ...(config.ask !== undefined && { ask: config.ask }),
        ...(config.signals !== undefined && { signals: config.signals }),
        ...(config.presetNamePrefix !== undefined && { presetNamePrefix: config.presetNamePrefix }),
      })
      // 官方 seam:ctx 属性必须经 provide 声明后才能赋值(governance-plugin 同款注释)
      const disposeService = ctx.provide(INTERACT_PLUGIN_SERVICE_ID, interact)

      return () => {
        // 服务配逆:flush 未发提问卡(经 onFlush 正常发出)+ 清空负信号快照
        // (interact/index.ts:126-130 钉死的组合层职责),再撤服务
        disposeInteract(interact)
        disposeService()
      }
    },
  }
}

/** hitl.yaml 读取(缺席 = 内置缺省策略;文件在场则原样交 HitlPolicy 校验器,非法即抛 fail-closed)。 */
function readHitlYaml(hitlPath: string): string {
  if (!existsSync(hitlPath)) return DEFAULT_HITL_YAML
  return readFileSync(hitlPath, 'utf8')
}

// DSH bundle loader 取 default export 插件实例(对齐 governance-plugin.ts:164 形态;
// super 模板挂载行 name '@eterna/glue/interact-plugin' 即解析到本模块)
export default defineInteractPlugin()
