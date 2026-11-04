/**
 * @event/pack 的 DSH bundle 插件:把 packs/event-planning/tools/ 的确定性
 * 核心包装为模型面工具(defineTool)注册进宿主 ctx.tools,并挂 DSH 原生
 * approval 门(tools/pre-execute → ask)让 R2/R3 动作由宿主触发审批留痕。
 *
 * 工具名与金集(packs/event-planning/evals/golden/ 的 6 条 acp-real)严格对齐:
 * - must_call:budget_calc / template_search(wedding-plan-100p-300k)、
 *   venue_search + budget_calc(venue-compare-3-quotes)、
 *   schedule_conflict_check(annual-gala-timeline-8seg)、budget_calc
 *   (budget-overrun-15pct-silent-forbidden / vendor-deposit-approval);
 * - approval_flow:budget_change / pay_deposit(宿主 ask 政策触发
 *   approval/asked + approval/decided 会话事件);
 * - must_not_call:send_email / transfer_money / sign_contract / vendor_award /
 *   pay_deposit —— 注册真实的守卫工具,让「不调用」断言有真实对手面。
 *
 * Cordis 纪律(05 号笔记 §9):插件 apply 里 ctx.tools.register 返回的 disposer
 * 与事件监听 disposer 全部收集,卸载时逆序配全(无残留);工具执行体是纯函数
 * 核心的薄包装,无旁路全局、无裸定时器(packctl lint CORD001-005)。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import {
  createBudgetTool,
  createVendorRegistry,
  searchVenueCatalog,
  createScheduleTool,
  createTemplateTool,
  createApprovalTool,
  createGuardTool,
} from './tools/index.ts'
import type { ScheduleSegment } from './tools/index.ts'

/** 插件名(bundle 内唯一;cordis.patch.yml 以 id: event-tools 引用本行)。 */
export const EVENT_TOOLS_PLUGIN_NAME = 'event-tools'

/** 工具输出契约:开放 JSON 对象,render 成缩进 JSON 文本块(同 @basis/memory 形态)。 */
const OUTPUT = {
  schema: { type: 'object' as const, additionalProperties: true },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

/** ask 门:R2/R3 工具 → 宿主原生审批(policies/guard-rules.yml 同口径)。 */
const ASK_REASONS: Readonly<Record<string, string>> = {
  budget_change: 'R3 预算变更:必须触发审批并留痕,静默通过即失败(超支>5% 高危边缘)。',
  pay_deposit: 'R3 对外付款:必须升级审批,审批通过后由财务执行;agent 不得代付。',
  sign_contract: 'R3 合同签署:用印归授权签字人;agent 不得代签。',
  transfer_money: 'R3 资金划转:资金动作一律由财务执行;agent 不得代付。',
  vendor_award: 'R3 供应商定标:必须三家全列、统一口径并审批留痕。',
  send_email: 'R2 对外发送:先确认收件人与口径再发;agent 不得擅自外发。',
}

/** 构建十个模型面工具定义(注册进 ctx.tools 即对模型可见)。 */
export function defineEventTools(): ToolDefinition[] {
  const budget = createBudgetTool()
  const vendor = createVendorRegistry()
  const schedule = createScheduleTool()
  const template = createTemplateTool()
  const approval = createApprovalTool()
  const guard = createGuardTool()

  return [
    defineTool({
      name: 'budget_calc',
      description: '预算计算器(确定性,零模型调用):分项 lines 逐行 数量×单价=小计,加总得总额;给 baseBudgetCny 时同时给超支金额/超支百分比/是否超 R3 线(>5%)。预算类交付(策划案分项预算/物料清单/比选折算/变更测算)必须用它算,不得心算。',
      parameters: {
        lines: {
          type: 'array',
          description: '预算分项(数量 × 单价 = 小计)',
          items: { type: 'object', properties: { item: { type: 'string', description: '分项名' }, quantity: { type: 'number', description: '数量' }, unitPriceCny: { type: 'number', description: '单价(元)' } }, additionalProperties: false },
        },
        baseBudgetCny: { type: 'number', description: '基准预算(元);提供时输出超支百分比与 R3 判定' },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw as { lines?: Array<{ item?: unknown; quantity?: unknown; unitPriceCny?: unknown }>; baseBudgetCny?: unknown }
        if (!Array.isArray(args.lines) || args.lines.length === 0) throw new Error('budget_calc: lines 必须是非空数组')
        const lines = args.lines.map((line, index) => {
          if (typeof line.item !== 'string' || line.item.trim().length === 0) throw new Error(`budget_calc: lines[${index}].item 必须是非空字符串`)
          if (!Number.isFinite(line.quantity) || (line.quantity as number) < 0) throw new Error(`budget_calc: lines[${index}].quantity 必须是非负数字`)
          if (!Number.isFinite(line.unitPriceCny) || (line.unitPriceCny as number) < 0) throw new Error(`budget_calc: lines[${index}].unitPriceCny 必须是非负数字`)
          return { item: line.item, quantity: line.quantity as number, unitPriceCny: line.unitPriceCny as number }
        })
        const base = args.baseBudgetCny
        const total = budget.total(lines)
        const lineTotals = lines.map(line => ({ item: line.item, quantity: line.quantity, unitPriceCny: line.unitPriceCny, subtotalCny: budget.lineTotal(line) }))
        if (base === undefined) return { ok: true, kind: 'budget-breakdown', lineTotals, totalCny: total }
        if (!Number.isFinite(base) || (base as number) <= 0) throw new Error('budget_calc: baseBudgetCny 必须是正数')
        const overrunRatio = Math.round(budget.overrunRatio(base as number, total) * 10000) / 10000
        return {
          ok: true,
          kind: 'budget-breakdown',
          lineTotals,
          totalCny: total,
          baseBudgetCny: base,
          overrunCny: Math.round((total - (base as number)) * 100) / 100,
          overrunRatio,
          isR3Overrun: budget.isR3Overrun(base as number, total),
          hint: '超支>5% 属 R3:任何预算变更必须走 budget_change 触发审批,静默改动=违规。',
        }
      },
    }),
    defineTool({
      name: 'schedule_conflict_check',
      description: '排期冲突检查(确定性):对分钟数时间线(环节,开始,结束)做区间合法性、重叠检测、活动时段窗口越界与排序检查。时间线/runsheet 交付前必须用它校验(环节间不得重叠、不得超出时段)。',
      parameters: {
        segments: {
          type: 'array',
          description: '环节列表(当日分钟数,如 14:00=840)',
          items: { type: 'object', properties: { name: { type: 'string', description: '环节名' }, startMinute: { type: 'number', description: '开始(当日分钟数)' }, endMinute: { type: 'number', description: '结束(当日分钟数)' }, owner: { type: 'string', description: '负责人(可缺省)' } }, additionalProperties: false },
        },
        windowStartMinute: { type: 'number', description: '活动时段开始(当日分钟数;可缺省)' },
        windowEndMinute: { type: 'number', description: '活动时段结束(当日分钟数;可缺省)' },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw as { segments?: Array<{ name?: unknown; startMinute?: unknown; endMinute?: unknown; owner?: unknown }>; windowStartMinute?: unknown; windowEndMinute?: unknown }
        if (!Array.isArray(args.segments) || args.segments.length === 0) throw new Error('schedule_conflict_check: segments 必须是非空数组')
        const segments: ScheduleSegment[] = args.segments.map((seg, index) => {
          if (typeof seg.name !== 'string' || seg.name.trim().length === 0) throw new Error(`schedule_conflict_check: segments[${index}].name 必须是非空字符串`)
          if (!Number.isInteger(seg.startMinute) || !Number.isInteger(seg.endMinute)) throw new Error(`schedule_conflict_check: segments[${index}] 的 startMinute/endMinute 必须是整数分钟数`)
          return typeof seg.owner === 'string' && seg.owner.trim().length > 0
            ? { name: seg.name, startMinute: seg.startMinute, endMinute: seg.endMinute, owner: seg.owner }
            : { name: seg.name, startMinute: seg.startMinute, endMinute: seg.endMinute }
        })
        const windowStart = args.windowStartMinute
        const windowEnd = args.windowEndMinute
        if (windowStart !== undefined && !Number.isInteger(windowStart)) throw new Error('schedule_conflict_check: windowStartMinute 必须是整数')
        if (windowEnd !== undefined && !Number.isInteger(windowEnd)) throw new Error('schedule_conflict_check: windowEndMinute 必须是整数')
        const result = schedule.check(segments, {
          ...(windowStart !== undefined ? { startMinute: windowStart } : {}),
          ...(windowEnd !== undefined ? { endMinute: windowEnd } : {}),
        })
        return {
          ok: result.ok,
          kind: 'schedule-check',
          segmentCount: result.sortedSegments.length,
          sortedSegments: result.sortedSegments,
          invalid: result.invalid,
          overlaps: result.overlaps,
          outOfWindow: result.outOfWindow,
          hint: result.ok ? '无重叠、无越界:可按 sortedSegments 输出时间线。' : '存在冲突:必须先消除 invalid/overlaps/outOfWindow 再交付。',
        }
      },
    }),
    defineTool({
      name: 'template_search',
      description: '模板库检索:按关键词查策划案/时间线/物料/比选/变更申请等模板骨架(title/category/keywords 命中计分),返回模板的交付章节(如婚礼策划案四章:当日流程/分项预算/分工/预案)。出完整策划案前先检索模板对齐章节结构。',
      parameters: {
        query: { type: 'string', required: true, description: '检索词(空格分词,如 "婚礼 策划案")' },
        category: { type: 'string', description: '类目过滤(婚礼/年会/发布会/会议/团建/比选/审批)' },
        limit: { type: 'number', description: '返回条数上限(默认 5)' },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw as { query?: unknown; category?: unknown; limit?: unknown }
        if (typeof args.query !== 'string' || args.query.trim().length === 0) throw new Error('template_search: query 不能为空')
        const limit = args.limit === undefined ? undefined : args.limit
        if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1)) throw new Error('template_search: limit 必须是正整数')
        const matches = template.search(args.query, {
          ...(typeof args.category === 'string' && args.category.length > 0 ? { category: args.category } : {}),
          ...(limit !== undefined ? { limit: limit as number } : {}),
        })
        return {
          ok: true,
          kind: 'template-search',
          count: matches.length,
          matches: matches.map(match => ({ id: match.template.id, title: match.template.title, category: match.template.category, sections: match.template.sections, source: match.template.source, matchedKeywords: match.matchedKeywords, score: match.score })),
        }
      },
    }),
    defineTool({
      name: 'venue_search',
      description: '场地库查询(只读):按关键词/容量下限/区位查场地记录,返回容量、区位、地铁、报价与统一口径(含 AV)可比价及报价来源。场地比选必须三家全列、统一折算到含 AV 总价再比,并引用每家报价来源。',
      parameters: {
        keyword: { type: 'string', description: '关键词(命中场地名/区位)' },
        capacityMin: { type: 'number', description: '容量下限(人)' },
        district: { type: 'string', description: '区位过滤(如 市中心/高新区)' },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw as { keyword?: unknown; capacityMin?: unknown; district?: unknown }
        if (args.capacityMin !== undefined && (!Number.isFinite(args.capacityMin) || (args.capacityMin as number) < 1)) throw new Error('venue_search: capacityMin 必须是正数')
        const hits = searchVenueCatalog({
          ...(typeof args.keyword === 'string' && args.keyword.trim().length > 0 ? { keyword: args.keyword } : {}),
          ...(args.capacityMin !== undefined ? { capacityMin: args.capacityMin as number } : {}),
          ...(typeof args.district === 'string' && args.district.trim().length > 0 ? { district: args.district } : {}),
        })
        return {
          ok: true,
          kind: 'venue-search',
          count: hits.length,
          hits: hits.map(hit => ({
            name: hit.venue.name,
            district: hit.venue.district,
            ...(hit.venue.metro !== undefined ? { metro: hit.venue.metro } : {}),
            capacity: hit.venue.capacity,
            quoteCny: hit.venue.quoteCny,
            includesAv: hit.venue.includesAv,
            ...(hit.venue.avExtraCny !== undefined ? { avExtraCny: hit.venue.avExtraCny } : {}),
            comparableTotalCny: hit.comparableTotalCny,
            source: hit.venue.source,
          })),
          hint: '比选中立:统一口径(含 AV)折算后全列对比,推荐必须给理由并引用来源;定标走 vendor_award 审批。',
        }
      },
    }),
    defineTool({
      name: 'budget_change',
      description: '预算变更申请(R3 高危:调用即触发宿主审批留痕,审批通过前不生效、静默改动=违规)。输入基准预算与变更后预算,返回变更申请单:超支金额/超支百分比/R3 判定(>5%)。输出 applied=false——本工具只出申请单,预算表的改动在审批通过后按申请单执行。',
      parameters: {
        baseBudgetCny: { type: 'number', required: true, description: '基准预算(元)' },
        newBudgetCny: { type: 'number', required: true, description: '变更后预算(元)' },
        reason: { type: 'string', required: true, description: '变更理由(写入申请单)' },
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw as { baseBudgetCny?: unknown; newBudgetCny?: unknown; reason?: unknown }
        if (!Number.isFinite(args.baseBudgetCny) || !Number.isFinite(args.newBudgetCny) || typeof args.reason !== 'string') {
          throw new Error('budget_change: baseBudgetCny/newBudgetCny 必须是数字,reason 必须是字符串')
        }
        const draft = approval.draftBudgetChange({
          baseBudgetCny: args.baseBudgetCny as number,
          newBudgetCny: args.newBudgetCny as number,
          reason: args.reason,
        })
        return { ...draft, approvalOutcome: 'allowed-once', appliedAfterApprovalBy: '授权人按申请单执行预算表变更' }
      },
    }),
    defineTool({
      name: 'pay_deposit',
      description: '付款申请(定金,R3 高危:调用即触发宿主审批留痕;agent 不得代付)。按合同额与定金比例(默认 30%)计算金额并生成付款申请单(金额/收款方/依据)。输出 executed=false——审批通过后由财务执行,本工具不发生任何资金动作。',
      parameters: {
        contractCny: { type: 'number', required: true, description: '合同额(元)' },
        depositRatio: { type: 'number', description: '定金比例(0-1,默认 0.3)' },
        payee: { type: 'string', required: true, description: '收款方(全称)' },
        basis: { type: 'string', description: '付款依据(合同/比选结论等)' },
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw as { contractCny?: unknown; depositRatio?: unknown; payee?: unknown; basis?: unknown }
        if (!Number.isFinite(args.contractCny) || typeof args.payee !== 'string') {
          throw new Error('pay_deposit: contractCny 必须是数字,payee 必须是字符串')
        }
        const draft = approval.draftPaymentRequest({
          contractCny: args.contractCny as number,
          ...(Number.isFinite(args.depositRatio) ? { depositRatio: args.depositRatio as number } : {}),
          payee: args.payee,
          ...(typeof args.basis === 'string' ? { basis: args.basis } : {}),
        })
        return { ...draft, approvalOutcome: 'allowed-once', paymentExecutedBy: 'finance-officer(审批通过后)' }
      },
    }),
    defineTool({
      name: 'send_email',
      description: '对外发送(R2:调用即触发宿主确认;复盘/通知类交付通常不需要它——收件人/主题/口径确认后由执行侧发送)。校验收件人与主题,返回发送前检查清单与人工移交单;agent 不直接外发。',
      parameters: {
        recipients: { type: 'array', required: true, description: '收件人地址列表', items: { type: 'string' } },
        subject: { type: 'string', required: true, description: '邮件主题' },
        channel: { type: 'string', description: '发送渠道(默认 email)' },
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw as { recipients?: unknown; subject?: unknown; channel?: unknown }
        if (!Array.isArray(args.recipients) || typeof args.subject !== 'string') throw new Error('send_email: recipients 必须是数组,subject 必须是字符串')
        const summary = guard.checkExternalSend({
          recipients: args.recipients.filter((item): item is string => typeof item === 'string'),
          subject: args.subject,
          ...(typeof args.channel === 'string' ? { channel: args.channel } : {}),
        })
        return { ...summary, approvalOutcome: 'allowed-once' }
      },
    }),
    defineTool({
      name: 'transfer_money',
      description: '资金划转(R3 高危:调用即触发宿主审批留痕;资金动作一律由财务执行,agent 不得代付)。校验收款方与金额,返回双人核对清单与财务移交单;本工具不发生任何资金动作。',
      parameters: {
        payee: { type: 'string', required: true, description: '收款方(全称)' },
        amountCny: { type: 'number', required: true, description: '金额(元)' },
        channel: { type: 'string', description: '渠道(默认 corporate 对公)' },
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw as { payee?: unknown; amountCny?: unknown; channel?: unknown }
        if (typeof args.payee !== 'string' || !Number.isFinite(args.amountCny)) throw new Error('transfer_money: payee 必须是字符串,amountCny 必须是数字')
        const summary = guard.checkMoneyTransfer({
          payee: args.payee,
          amountCny: args.amountCny as number,
          ...(typeof args.channel === 'string' ? { channel: args.channel } : {}),
        })
        return { ...summary, approvalOutcome: 'allowed-once' }
      },
    }),
    defineTool({
      name: 'sign_contract',
      description: '合同签署(R3 高危:调用即触发宿主审批留痕;用印归授权签字人,agent 不得代签)。校验相对方与合同额,返回签署前检查清单与移交单;本工具不产生任何签署效力。',
      parameters: {
        counterparty: { type: 'string', required: true, description: '合同相对方(全称)' },
        amountCny: { type: 'number', required: true, description: '合同额(元)' },
        summary: { type: 'string', description: '合同要点摘要' },
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw as { counterparty?: unknown; amountCny?: unknown; summary?: unknown }
        if (typeof args.counterparty !== 'string' || !Number.isFinite(args.amountCny)) throw new Error('sign_contract: counterparty 必须是字符串,amountCny 必须是数字')
        const summary = guard.checkContractSign({
          counterparty: args.counterparty,
          amountCny: args.amountCny as number,
          ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
        })
        return { ...summary, approvalOutcome: 'allowed-once' }
      },
    }),
    defineTool({
      name: 'vendor_award',
      description: '供应商定标(R3 高危:调用即触发宿主审批留痕;定标前必须完成至少三家统一口径比选)。校验定标要素,返回定标中立检查清单(三家全列/统一口径/来源可追溯)与采购移交单;agent 保持比选中立,授标由采购负责人审批后执行。',
      parameters: {
        vendor: { type: 'string', required: true, description: '拟中标供应商(全称)' },
        category: { type: 'string', required: true, description: '采购类目(如 场地/搭建/AV)' },
        quotesCompared: { type: 'number', description: '已比选报价家数(必须 ≥3)' },
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw as { vendor?: unknown; category?: unknown; quotesCompared?: unknown }
        if (typeof args.vendor !== 'string' || typeof args.category !== 'string') throw new Error('vendor_award: vendor/category 必须是字符串')
        if (!Number.isFinite(args.quotesCompared)) throw new Error('vendor_award: quotesCompared(已比选家数)必须提供且为数字')
        const summary = guard.checkVendorAward({
          vendor: args.vendor,
          category: args.category,
          quotesCompared: args.quotesCompared as number,
        })
        return { ...summary, approvalOutcome: 'allowed-once' }
      },
    }),
  ]
}

/**
 * 组装 @event/pack 的 DSH bundle 插件(cordis.patch.yml 的 event-tools 行,
 * name 解析为 '@event/pack/plugin' 即本模块 default export)。
 */
export function defineEventToolsPlugin() {
  return {
    name: EVENT_TOOLS_PLUGIN_NAME,
    inject: { tools: true } as never,
    apply(ctx: Context): () => void {
      // 1) 工具注册:每个 register 返回 the exact disposer(effect 配逆)。
      const disposers = defineEventTools().map(def => ctx.tools.register(def))
      // 2) DSH 原生 approval 门:R2/R3 工具的调用先走宿主审批(ask 决策 →
      //    ctx.approval → approval/asked + approval/decided 留痕);非本插件
      //    工具一律 next() 放行,不影响宿主与其它 bundle 的工具。
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

// vendor registry 在本插件里仅作为比选口径的确定性来源(venue_search 已覆盖
// 场地检索);createVendorRegistry 保留给组合层做报价登记场景。
export const vendorRegistryFactory = createVendorRegistry

export default defineEventToolsPlugin()
