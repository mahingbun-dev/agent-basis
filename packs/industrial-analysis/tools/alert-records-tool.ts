/**
 * 预警记录工具(确定性桩;首场景③ 预警研判的写侧核心)。
 * 预警记录表(达梦)是本包唯一放行的写路径(guard-rules.yml 红线①白名单单点):
 * 其余任何库表写动作 deny。桩内为内存表(重启即失),真实实现经 MCP 写达梦预警记录表。
 *
 * Cordis 纪律形态:
 * - 注册表 + 唯一 ID:@industrial-analysis/alert-records-tool(packctl lint CORD004);
 * - 无旁路全局、无裸定时器、无 Date.now(recordedAt 用桩内固定时刻,确定性,CORD001);
 * - 副作用型工具:由 ../plugin.ts 的 effect 注册并配逆闭包 disposer(卸载无残留)。
 */

/** 唯一 ID(注册表键;@industrial-analysis/* 命名空间)。 */
export const ALERT_RECORDS_TOOL_SERVICE_ID = '@industrial-analysis/alert-records-tool'

/** 记录输入:研判结论写回预警记录表(alertId + 处置动作必填)。 */
export interface AlertRecordInput {
  readonly alertId: string
  readonly treatment: string
  readonly outcome?: string
  readonly note?: string
  readonly operator?: string
}

/** 预警记录表行。 */
export interface AlertRecord {
  readonly recordId: string
  readonly alertId: string
  readonly treatment: string
  readonly outcome?: string
  readonly note?: string
  readonly operator: string
  readonly recordedAt: string
  readonly source: 'stub-sample'
}

export interface AlertRecordsResult {
  readonly count: number
  readonly records: readonly AlertRecord[]
  /** 写域声明:本表是达梦唯一放行的写路径(R1 档,事后变更卡片)。 */
  readonly writeScope: 'alert-records-table-only'
}

/** 可交换接口:任何提供同等 id 与能力的实现(真实 Alert MCP 写侧)可整体替换本模块。 */
export interface IndustrialAlertRecordsTool {
  readonly id: typeof ALERT_RECORDS_TOOL_SERVICE_ID
  /** 追加一条预警处置记录(recordId 桩内自增,确定性);alertId/treatment 必填。 */
  append(input: AlertRecordInput): AlertRecord
  /** 读取全部预警记录(含种子与本次会话追加)。 */
  list(): AlertRecordsResult
}

/** 桩内固定「当前时刻」(确定性;真实实现由 MCP 侧打点)。 */
const STUB_RECORDED_AT = '2026-11-07 09:00'

/** 默认操作人:agent 起草的记录必须可识别,不冒充人工记录(persona 红线)。 */
const AGENT_OPERATOR = 'agent-draft'

/** 种子记录(写死;对齐 alert-list 桩的样例告警)。 */
const SEED: readonly AlertRecord[] = [
  {
    recordId: 'REC-0001',
    alertId: 'AL-20261106-003',
    treatment: '现场确认流量回升,观察至班末',
    outcome: '维持监控,未升级',
    operator: '运行甲班',
    recordedAt: '2026-11-06 15:10',
    source: 'stub-sample',
  },
]

export function createAlertRecordsTool(): IndustrialAlertRecordsTool {
  // 实例内可变状态(effect 状态):插件卸载随实例一起丢弃,不落旁路全局。
  const records: AlertRecord[] = [...SEED]
  let nextSeq = records.length + 1
  return {
    id: ALERT_RECORDS_TOOL_SERVICE_ID,
    append(input) {
      if (typeof input.alertId !== 'string' || input.alertId.trim().length === 0) {
        throw new Error('alert_records: alertId 必填(写回必须挂在具体告警上)')
      }
      if (typeof input.treatment !== 'string' || input.treatment.trim().length === 0) {
        throw new Error('alert_records: treatment(处置动作)必填')
      }
      const record: AlertRecord = {
        recordId: `REC-${String(nextSeq).padStart(4, '0')}`,
        alertId: input.alertId.trim(),
        treatment: input.treatment.trim(),
        ...(input.outcome !== undefined && input.outcome.trim().length > 0 ? { outcome: input.outcome.trim() } : {}),
        ...(input.note !== undefined && input.note.trim().length > 0 ? { note: input.note.trim() } : {}),
        operator: input.operator !== undefined && input.operator.trim().length > 0 ? input.operator.trim() : AGENT_OPERATOR,
        recordedAt: STUB_RECORDED_AT,
        source: 'stub-sample',
      }
      nextSeq += 1
      records.push(record)
      return record
    },
    list() {
      return { count: records.length, records: [...records], writeScope: 'alert-records-table-only' as const }
    },
  }
}
