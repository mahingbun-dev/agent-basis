/**
 * 预警列表工具(确定性桩;首场景③ 预警研判的读侧核心)。
 * 当前告警 + 样例规则库限值写死在桩内(Alert MCP 接入前的桩);分级对齐规则库 RULE-*,
 * 限值不自行发明。数据与规则层只经 MCP 访问(persona 红线②)。
 *
 * Cordis 纪律形态:
 * - 注册表 + 唯一 ID:@industrial-analysis/alert-list-tool(packctl lint CORD004);
 * - 纯函数实现:无旁路全局、无裸定时器(CORD001);只读(R0 档)。
 */

/** 唯一 ID(注册表键;@industrial-analysis/* 命名空间)。 */
export const ALERT_LIST_TOOL_SERVICE_ID = '@industrial-analysis/alert-list-tool'

export type AlertSeverity = 'P0' | 'P1' | 'P2'
export type AlertStatus = 'active' | 'acknowledged' | 'closed'

/** 当前告警条目(与样例测点台账 / 规则库口径一致)。 */
export interface IndustrialAlert {
  readonly alertId: string
  readonly ruleId: string
  readonly severity: AlertSeverity
  readonly asset: string
  readonly metric: string
  readonly triggeredAt: string
  readonly value: number
  readonly limit: number
  readonly status: AlertStatus
  readonly description: string
  readonly source: 'stub-sample'
}

export interface AlertListFilters {
  readonly severity?: AlertSeverity
  readonly asset?: string
  readonly status?: AlertStatus
}

export interface AlertListResult {
  readonly count: number
  readonly alerts: readonly IndustrialAlert[]
  readonly source: 'stub-sample'
}

/** 可交换接口:任何提供同等 id 与能力的实现(真实 Alert MCP)可整体替换本模块。 */
export interface IndustrialAlertListTool {
  readonly id: typeof ALERT_LIST_TOOL_SERVICE_ID
  /** 查询当前告警;非法 severity/status 抛错(口径不猜)。 */
  list(filters?: AlertListFilters): AlertListResult
}

/** 样例告警(写死,确定性;与 timeseries 桩同一天 2026-11-06)。 */
const ALERTS: readonly IndustrialAlert[] = [
  {
    alertId: 'AL-20261106-004',
    ruleId: 'RULE-PRESS-HIGH-060',
    severity: 'P0',
    asset: 'unit1.reactor',
    metric: 'unit1.reactor.press',
    triggeredAt: '2026-11-06 13:00',
    value: 0.61,
    limit: 0.6,
    status: 'active',
    description: '1#反应釜压力 0.61 MPa 超跳机限值 0.60 MPa(RULE-PRESS-HIGH-060),须立即处置。',
    source: 'stub-sample',
  },
  {
    alertId: 'AL-20261106-001',
    ruleId: 'RULE-TEMP-HIGH-190',
    severity: 'P1',
    asset: 'unit1.reactor',
    metric: 'unit1.reactor.temp',
    triggeredAt: '2026-11-06 09:00',
    value: 191.2,
    limit: 190,
    status: 'active',
    description: '1#反应釜温度连续越限(RULE-TEMP-HIGH-190),窗口峰值 196.2 °C(13:00),16:00 回落。',
    source: 'stub-sample',
  },
  {
    alertId: 'AL-20261106-002',
    ruleId: 'RULE-VIB-ISO10816',
    severity: 'P1',
    asset: 'line2.motor',
    metric: 'line2.motor.vib',
    triggeredAt: '2026-11-06 16:00',
    value: 4.8,
    limit: 4.5,
    status: 'active',
    description: '2#线电机轴承振动 4.8 mm/s 超 ISO 10816 C 区限值 4.5(RULE-VIB-ISO10816)。',
    source: 'stub-sample',
  },
  {
    alertId: 'AL-20261106-003',
    ruleId: 'RULE-STEAM-LOW-35',
    severity: 'P2',
    asset: 'boiler1',
    metric: 'boiler1.steam.flow',
    triggeredAt: '2026-11-06 14:00',
    value: 33.5,
    limit: 35,
    status: 'acknowledged',
    description: '1#锅炉蒸汽流量 33.5 t/h 短时低于下限 35(低限告警 RULE-STEAM-LOW-35),15:00 已回升。',
    source: 'stub-sample',
  },
]

const SEVERITIES: readonly AlertSeverity[] = ['P0', 'P1', 'P2']
const STATUSES: readonly AlertStatus[] = ['active', 'acknowledged', 'closed']

export function createAlertListTool(): IndustrialAlertListTool {
  return {
    id: ALERT_LIST_TOOL_SERVICE_ID,
    list(filters) {
      const severity = filters?.severity
      if (severity !== undefined && !SEVERITIES.includes(severity)) {
        throw new Error(`alert_list: severity 必须是 P0|P1|P2,收到: ${String(severity)}`)
      }
      const status = filters?.status
      if (status !== undefined && !STATUSES.includes(status)) {
        throw new Error(`alert_list: status 必须是 active|acknowledged|closed,收到: ${String(status)}`)
      }
      const asset = filters?.asset
      const alerts = ALERTS.filter(alert =>
        (severity === undefined || alert.severity === severity)
        && (status === undefined || alert.status === status)
        && (asset === undefined || alert.asset === asset))
      return { count: alerts.length, alerts, source: 'stub-sample' }
    },
  }
}
