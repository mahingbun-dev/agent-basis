/**
 * @industrial-analysis/pack 的 DSH bundle 插件:把 tools/ 的确定性工具桩包装为
 * 模型面工具(defineTool)注册进宿主 ctx.tools,并挂 DSH 原生 approval 门
 * (tools/pre-execute → ask)让对外发送类动作由宿主触发审批留痕(红线③,R2)。
 *
 * 工具名与金集(packs/industrial-analysis/evals/golden/)严格对齐:
 * - must_call:timeseries_query(reactor-temp-trend-24h / motor-vib-anomaly-summary /
 *   temp-fabrication-forbidden)、alert_list + alert_records(alert-p1-triage-playbook);
 * - must_not_call:send_report / send_alert_notify / publish_report
 *   (alert-notify-send-must-confirm:对外发送必须确认,不做裸发射)、
 *   dm_update / db_update(dm-write-beyond-alert-table-denied:达梦只读红线)。
 *
 * Cordis 纪律(05 号笔记 §9):插件 apply 里 ctx.tools.register 返回的 disposer
 * 与事件监听 disposer 全部收集,卸载时逆序配全(无残留);工具执行体是纯函数核心的
 * 薄包装,无旁路全局、无裸定时器(packctl lint CORD001-005)。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { createTimeseriesTool, createAlertListTool, createAlertRecordsTool } from './tools/index.ts'

/** 插件名(bundle 内唯一;cordis.patch.yml 以 id: industrial-tools 引用本行)。 */
export const INDUSTRIAL_TOOLS_PLUGIN_NAME = 'industrial-tools'

/** 工具输出契约:开放 JSON 对象,render 成缩进 JSON 文本块(同 @event/pack 形态)。 */
const OUTPUT = {
  schema: { type: 'object' as const, additionalProperties: true },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

/**
 * ask 门:对外发送类(R2)工具 → 宿主原生审批。本包未注册这三类工具 —— 门挂在宿主
 * pre-execute 通道上,任何 bundle 提供的对外发送动作统一先确认再发(guard-rules.yml
 * 的 industrial-ask-external-send 同口径);非命中一律 next() 放行,不影响宿主与其它
 * bundle 的工具。deny 优先 fail-closed 的执行在 @basis/governance(规则引擎)。
 */
const ASK_REASONS: Readonly<Record<string, string>> = {
  send_report: 'R2 对外发送:报告下发必须先确认收件人与口径,withhold-或-补偿,不做裸发射。',
  send_alert_notify: 'R2 对外发送:预警通报(短信/邮件/群发)必须先确认收件人与口径,不做裸发射。',
  publish_report: 'R2 对外发布:报告/通报对外发布必须先确认范围与口径,不做裸发射。',
}

/** 构建三个模型面工具定义(注册进 ctx.tools 即对模型可见;确定性桩,样例数据在 tools/ 内)。 */
export function defineIndustrialTools(): ToolDefinition[] {
  const timeseries = createTimeseriesTool()
  const alertList = createAlertListTool()
  const alertRecords = createAlertRecordsTool()

  return [
    defineTool({
      name: 'timeseries_query',
      description: '工业时序查询(确定性,R0 只读,经 MCP 检索 TDengine):按测点 tag + 时间窗返回数据点、统计(min/max/avg/首末)与趋势(方向/峰谷);给 threshold(来自规则库 RULE-*)时输出越限时刻。查不到测点会报错——明说查不到,不编造测点数据;数据源声明见输出 source 字段(样例/实测)。',
      parameters: {
        tag: { type: 'string', required: true, description: '测点 tag(如 unit1.reactor.temp;不确定先看工具报错里指向的台账,绝不臆造)' },
        start: { type: 'string', description: '窗口起点(YYYY-MM-DD 或 YYYY-MM-DD HH:mm,可缺省=全样例窗口)' },
        end: { type: 'string', description: '窗口终点(同上格式,含终点)' },
        threshold: { type: 'number', description: '越限判定上限(选填;来自预警规则库 RULE-*,不自行发明限值)' },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw as { tag?: unknown; start?: unknown; end?: unknown; threshold?: unknown }
        if (typeof args.tag !== 'string' || args.tag.trim().length === 0) throw new Error('timeseries_query: tag 必填(非空字符串)')
        if (args.start !== undefined && typeof args.start !== 'string') throw new Error('timeseries_query: start 必须是字符串')
        if (args.end !== undefined && typeof args.end !== 'string') throw new Error('timeseries_query: end 必须是字符串')
        if (args.threshold !== undefined && !Number.isFinite(args.threshold)) throw new Error('timeseries_query: threshold 必须是数字')
        return timeseries.query(args.tag, {
          ...(typeof args.start === 'string' ? { start: args.start } : {}),
          ...(typeof args.end === 'string' ? { end: args.end } : {}),
          ...(typeof args.threshold === 'number' ? { threshold: args.threshold } : {}),
        })
      },
    }),
    defineTool({
      name: 'alert_list',
      description: '当前告警查询(确定性,R0 只读,经 MCP 访问预警层):按严重级(P0/P1/P2)/资产/状态(active/acknowledged/closed)过滤,返回告警的规则 id(RULE-*)、触发值与限值、触发时刻与描述。预警研判前必用——先看规则与触发值,不凭印象分级。',
      parameters: {
        severity: { type: 'string', description: '严重级过滤:P0|P1|P2' },
        asset: { type: 'string', description: '资产过滤(如 unit1.reactor)' },
        status: { type: 'string', description: '状态过滤:active|acknowledged|closed' },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw as { severity?: unknown; asset?: unknown; status?: unknown }
        if (args.severity !== undefined && typeof args.severity !== 'string') throw new Error('alert_list: severity 必须是字符串')
        if (args.asset !== undefined && typeof args.asset !== 'string') throw new Error('alert_list: asset 必须是字符串')
        if (args.status !== undefined && typeof args.status !== 'string') throw new Error('alert_list: status 必须是字符串')
        return alertList.list({
          ...(typeof args.severity === 'string' ? { severity: args.severity as never } : {}),
          ...(typeof args.asset === 'string' && args.asset.length > 0 ? { asset: args.asset } : {}),
          ...(typeof args.status === 'string' ? { status: args.status as never } : {}),
        })
      },
    }),
    defineTool({
      name: 'alert_records',
      description: '预警记录表(达梦唯一放行的写路径,R1 档;op=list 只读,op=append 写回处置记录并留 agent-draft 操作人)。预警研判结论写回用 append:alertId + treatment 必填;其余任何库表写动作都是 deny——静默写库=失败。',
      parameters: {
        op: { type: 'string', required: true, description: '操作:list(读全部记录)| append(写回一条处置记录)' },
        alertId: { type: 'string', description: 'op=append 必填:挂在哪条告警上(如 AL-20261106-001)' },
        treatment: { type: 'string', description: 'op=append 必填:处置动作(做了什么)' },
        outcome: { type: 'string', description: 'op=append 选填:处置结果' },
        note: { type: 'string', description: 'op=append 选填:备注(待确认项等)' },
        operator: { type: 'string', description: 'op=append 选填:操作人;缺省记 agent-draft(不冒充人工记录)' },
      },
      output: OUTPUT,
      isConcurrencySafe: () => false,
      async execute(argsRaw) {
        const args = argsRaw as { op?: unknown; alertId?: unknown; treatment?: unknown; outcome?: unknown; note?: unknown; operator?: unknown }
        if (args.op !== 'list' && args.op !== 'append') throw new Error('alert_records: op 必须是 list|append')
        if (args.op === 'append') {
          if (typeof args.alertId !== 'string' || typeof args.treatment !== 'string') {
            throw new Error('alert_records: op=append 需要 alertId 与 treatment(均为字符串)')
          }
          const record = alertRecords.append({
            alertId: args.alertId,
            treatment: args.treatment,
            ...(typeof args.outcome === 'string' ? { outcome: args.outcome } : {}),
            ...(typeof args.note === 'string' ? { note: args.note } : {}),
            ...(typeof args.operator === 'string' ? { operator: args.operator } : {}),
          })
          return { ok: true as const, ...record, writeScope: 'alert-records-table-only' as const, hint: '写回仅限预警记录表(达梦唯一放行写路径,R1);其余写动作 deny。' }
        }
        return { ok: true as const, ...alertRecords.list() }
      },
    }),
  ]
}

/**
 * 组装 @industrial-analysis/pack 的 DSH bundle 插件(cordis.patch.yml 的
 * industrial-tools 行,name 解析为 '@industrial-analysis/pack/plugin' 即本模块
 * default export)。apply 收集全部 disposer,返回逆闭包:卸载时逆序配全,无残留。
 */
export function defineIndustrialToolsPlugin() {
  return {
    name: INDUSTRIAL_TOOLS_PLUGIN_NAME,
    inject: { tools: true } as never,
    apply(ctx: Context): () => void {
      // 1) 工具注册:每个 register 返回的 disposer 全量收集(effect 配逆)。
      const disposers = defineIndustrialTools().map(def => ctx.tools.register(def))
      // 2) DSH 原生 approval 门:对外发送类(R2)先走宿主确认(ask 决策 →
      //    ctx.approval 留痕);非命中一律 next() 放行。
      const offGate = ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
        const reason = ASK_REASONS[exec.name]
        return reason === undefined ? await next() : { kind: 'ask', reason }
      })
      let disposed = false
      return (): void => {
        if (disposed) return
        disposed = true
        for (const dispose of disposers.splice(0)) dispose()
        offGate()
      }
    },
  }
}

export default defineIndustrialToolsPlugin()
