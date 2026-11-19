/**
 * 领域内核 barrel——零 I/O、零外部依赖的纯函数件(SA/src/core 移植面)。
 *
 * 设计依据:34 号 §1 目录树与 §2.1 模块映射表;35 号 A1(空目录骨架)+ A3–A9(逐件落地):
 * - A3 纯函数底座【已落地】:model.ts / ids.ts / reasons.ts / errors.ts / stage.ts / memory.ts(内存仓库,测试与临时实例用)。
 * - A5 单写者骨架【已落地 ports.ts / part.ts / engine.ts】:Engine 唯一事务入口与五个角色
 *   Pick 接口经 engine.ts 转出(ports:ticket.ended 载荷增加 realm 字段;part:EngineOptions
 *   增加 realmOf 注入项);EnginePart 基类不进门面(对齐 SA barrel,经各部件文件消费)
 * - A6 摄取【已落地】:intake.ts(receive 幂等三态 stored/duplicate/filtered + realm 标注)
 * - A7 评估【已落地】:evals.ts(Decision / R3 四要素硬约束 delegationIncomplete)
 * - A8 工单【已落地】:tickets.ts(生命周期 / Subscription / 冲突机制④「只通知不撤销」/ 交接)
 * - A9 报告【已落地】:assignments.ts(六态 + Attention)/ replies.ts(四种 purpose 回执规则)
 *
 * 改造要点(34 §2.1):Mandate 与 Ticket 增必填 realm: string;ThreadRef/Trigger 不加;
 * 谓词 followupOwners / waitsForPerson 原样保留(P0 台账与 28 §6「等谁」可见化建在其上)。
 */
export * from './model.ts'
export * from './ports.ts'
export { Engine, type EngineForExecutor, type EngineForMainSession, type EngineForPeople, type EngineForSettings, type EngineForSources,
  type EngineOptions, type Outcome, type ReceiveResult, type Reply, type ReplyRequest, type WorkerReport } from './engine.ts'
export { MemoryRepositories } from './memory.ts'
export { UserError, USER_ERRORS, type UserErrorCode } from './errors.ts'
export { REASONS, reasonText, said, type Reason, type ReasonCode } from './reasons.ts'
export { canRetry, ticketStage, type TicketStage } from './stage.ts'
export { key } from './ids.ts'
