/**
 * Source 端口——Trigger 归一化契约与 SourceScope 监听范围面(35 号 A21;34 号 §2.5
 * port 行「只取 SA Source 契约面:Trigger 归一化、SourceScope.scope 返回
 * listened/observed/row(SA core/ports.ts:9-14);注册表与轮询不搬——channels 是统一
 * 接收面(24a 拍板 A5)」)。
 *
 * 分工(34 号 §2.5 channel-adapter 行 + 39 号 §3-E2 的对端合拢语义):
 * - channels 侧(已随 39-E2 交付):Source kind 注册表与归一化(`packages/channels/
 *   src/source.ts`),把渠道事件归一化为其内部中立 Trigger(trigger.ts,类型与本包
 *   core 逐字段同构;31 号 §2.2 铁律 1 下 channels 不 import Tier2,两侧同构由
 *   下方的编译期钉住看护);
 * - tasks 侧(本目录):适配端口——`SourceSink` 即 channels TriggerSink 的结构镜像
 *   (receive 三态/bindThread/threadClosed),`ChannelTriggerAdapter`(channel-adapter.ts)
 *   以 tasks core key() 重派幂等 id 后把 Trigger 送进 Engine(EngineForSources,
 *   engine.ts:284),并把 PR 生命周期转发(bindThread/threadClosed)落到 Engine;
 * - scope 监听范围:领域视角的 `SourceScope`(core/ports.ts)经 Engine 的 intake 消费
 *   (intake.ts:37-40 filtered 落库),本端口不复制其定义,仅在此声明其契约地位
 *   (SA core/ports.ts:9-14 的 `ScopeResult` 同款 listened/observed/row 三元)。
 *
 * 依赖方向(34 号 §1):tasks → channels 仅类型与纯函数(接线经端口注入,不 import
 * 服务实例);本文件对 channels 的引用全部 `import type`,运行时零耦合。
 */
import type { ThreadRef, Trigger } from '../core/model.ts'
import type { TriggerSink, LifecycleForward } from '@eterna/channels'

/** 既有契约的再声明位:SourceScope 的监听范围三元(SA core/ports.ts:9-14 原文面)。 */
export type { ScopeResult, SourceScope } from '../core/ports.ts'

/**
 * channels → tasks 的入站汇端口(`ChannelTriggerAdapter` 实现它;glue 组合层把它按
 * 结构类型注给 channels 的 `TriggerSink`——39 号 §3-E2「组合层按结构类型把 tasks
 * Engine 注入 TriggerSink」)。签名与 34 号 §3 EngineForSources 调用面逐项对齐:
 * - `receive`:归一化后的 Trigger 进 Engine,幂等三态 stored/duplicate/filtered 由
 *   Engine.receive(intake.ts:19-62)裁决回传(27 号 §3.3 情况 C:重复投递收敛一单);
 * - `bindThread(ticketId, threadKey, own)`:Source 扩展钩子的绑定半边(PR 生命周期类,
 *   A5 拍板保留);threadKey 为 channels 不透明键,适配层负责解析回 ThreadRef;
 * - `threadClosed(threadKey, outcome, at)`:线程关闭 → followsDone 收尾
 *   (34 §2.5「GitHub PR merge→threadClosed」的落点)。
 */
export interface SourceSink {
  receive(trigger: Trigger): 'stored' | 'duplicate' | 'filtered'
  bindThread(ticketId: string, threadKey: string, own: boolean): unknown
  threadClosed(threadKey: string, outcome: 'merged' | 'closed', at: string): void
}

// ── 同构钉住(channels trigger.ts 头注的契约载体,漂移即接线断裂)────────────────
// channels 的中立 Trigger/引用类型与本包 core 的同名类型逐字段同构;Tier2→Tier1 的
// 类型依赖合法(34 §1),此处在编译期钉住「channels 产出恒可赋给 core 契约」——
// channels 侧字段漂移(增删必填/改宽窄)时,`pnpm --filter @eterna/tasks run verify`
// 的 tsc 阶段即失败,与 tests/types.seam-pin.ts 的 DSH seam 钉住同款纪律。

/** channels 中立 ThreadRef 可赋给 core ThreadRef(线程键 `${source}:${id}` 同构)。 */
export type ChannelsThreadRefAligned = import('@eterna/channels').ThreadRef extends ThreadRef ? true : never
/** channels 中立 Trigger 可赋给 core Trigger(幂等 id/actor/threads/human/at/text 契约面)。 */
export type ChannelsTriggerAligned = import('@eterna/channels').Trigger extends Trigger ? true : never
/** tasks 的 SourceSink 恒满足 channels TriggerSink 的调用面(结构注入的编译期证据)。 */
export type SourceSinkIsTriggerSink = SourceSink extends TriggerSink ? true : never
/** channels 的生命周期转发指令形态(bindThread/threadClosed 两式)原样进适配层。 */
export type ChannelsLifecycleForward = LifecycleForward
