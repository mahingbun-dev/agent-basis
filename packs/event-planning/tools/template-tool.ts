/**
 * 模板库检索(13 号文档 §3 工具候选;golden wedding-plan-100p-300k /
 * gala-speaker-contingency 的 must_call 目标)。
 *
 * 内置行业模板骨架(章节名与 golden 终态断言同口径,如婚礼策划案四章:
 * 当日流程 / 分项预算 / 分工 / 预案),按关键词命中计分排序,纯函数零模型调用。
 * 真实模板库接 @eterna/knowledge(WeKnora)时接口不变整体替换。
 *
 * Cordis 纪律:注册表 + 唯一 ID(@event/template-tool),纯函数,无旁路全局。
 */

/** 唯一 ID(注册表键;@event/* 命名空间)。 */
export const TEMPLATE_TOOL_SERVICE_ID = '@event/template-tool'

/** 一份策划模板骨架(sections 即交付章节)。 */
export interface PlanTemplate {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly keywords: readonly string[]
  readonly sections: readonly string[]
  readonly source: string
}

/** 检索命中(命中关键词与计分)。 */
export interface TemplateMatch {
  readonly template: PlanTemplate
  readonly matchedKeywords: readonly string[]
  readonly score: number
}

/** 可交换接口:任何提供同等 id 与能力的实现可整体替换本模块。 */
export interface EventTemplateTool {
  readonly id: typeof TEMPLATE_TOOL_SERVICE_ID
  /** 关键词检索(query 按空白切分;命中 title/category/keywords 计分,降序截 limit)。 */
  search(query: string, options?: { readonly category?: string; readonly limit?: number }): readonly TemplateMatch[]
  /** 按 id 精确取模板。 */
  byId(id: string): PlanTemplate | undefined
}

/** 内置模板库(样例骨架;S2 接真实模板库后由种子数据迁移)。 */
export const TEMPLATE_LIBRARY: readonly PlanTemplate[] = [
  {
    id: 'wedding-plan-standard',
    title: '婚礼策划案(标准全案)',
    category: '婚礼',
    keywords: ['婚礼', '婚宴', '策划案', '仪式', '宴会厅', '百日宴'],
    sections: ['当日流程', '分项预算', '分工', '预案'],
    source: 'packs/event-planning/skills/budget-sourcing-approval',
  },
  {
    id: 'annual-gala-halfday',
    title: '年会半天流程与预算',
    category: '年会',
    keywords: ['年会', '庆典', '周年庆', '半天', '颁奖', '晚宴'],
    sections: ['时间线', '分项预算', '分工', '节目预案'],
    source: 'packs/event-planning/skills/event-delivery-workflow',
  },
  {
    id: 'product-launch-150p',
    title: '产品发布会执行框架',
    category: '发布会',
    keywords: ['发布会', '上市', '媒体', '演示', '口径', '直播'],
    sections: ['媒体口径', '演示流程', '分项预算', '风险预案'],
    source: 'packs/event-planning/skills/event-delivery-workflow',
  },
  {
    id: 'conference-runsheet',
    title: '会议执行手册(30 分钟粒度)',
    category: '会议',
    keywords: ['会议', '论坛', '手册', 'runsheet', '签到', '茶歇'],
    sections: ['分钟级流程', '物料清单', '分工', '应急预案'],
    source: 'packs/event-planning/skills/event-delivery-workflow',
  },
  {
    id: 'teambuilding-urban',
    title: '团建活动方案(市区一日)',
    category: '团建',
    keywords: ['团建', '拓展', '一日', '市区', '破冰'],
    sections: ['行程', '预算', '分组', '天气预案'],
    source: 'packs/event-planning/skills/event-delivery-workflow',
  },
  {
    id: 'outdoor-planb',
    title: '户外活动雨备 Plan B',
    category: '婚礼',
    keywords: ['户外', '婚礼', '雨备', '备用场地', '切换'],
    sections: ['雨备触发条件', '备用场地', '切换流程', '通知口径'],
    source: 'packs/event-planning/skills/event-delivery-workflow',
  },
  {
    id: 'venue-comparison-matrix',
    title: '场地比选对照表',
    category: '比选',
    keywords: ['场地', '比选', '报价', '对比', '定标'],
    sections: ['统一口径折算', '对照表', '推荐理由', '报价来源'],
    source: 'packs/event-planning/skills/budget-sourcing-approval',
  },
  {
    id: 'budget-change-request',
    title: '预算变更申请单(R3)',
    category: '审批',
    keywords: ['预算', '变更', '超支', '审批', 'R3'],
    sections: ['变更内容', '超支测算', '影响与理由', '审批留痕'],
    source: 'packs/event-planning/skills/budget-sourcing-approval',
  },
]

export function createTemplateTool(library: readonly PlanTemplate[] = TEMPLATE_LIBRARY): EventTemplateTool {
  return {
    id: TEMPLATE_TOOL_SERVICE_ID,
    byId(id) {
      return library.find(template => template.id === id)
    },
    search(query, options) {
      const limit = options?.limit ?? 5
      const terms = query.split(/\s+/).map(term => term.trim()).filter(term => term.length > 0)
      const matches: TemplateMatch[] = []
      for (const template of library) {
        if (options?.category !== undefined && template.category !== options.category) continue
        const matched = collectMatches(template, terms)
        if (matched.length === 0) continue
        matches.push({ template, matchedKeywords: matched, score: matched.length })
      }
      matches.sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id))
      return matches.slice(0, Math.max(0, limit))
    },
  }
}

/** 收集命中的关键词(title 命中计 2,category/keywords 命中计 1;关键词去重)。 */
function collectMatches(template: PlanTemplate, terms: readonly string[]): string[] {
  const hit = new Set<string>()
  for (const term of terms) {
    if (template.title.includes(term)) hit.add(term)
    else if (template.category.includes(term) || template.keywords.some(keyword => keyword.includes(term))) hit.add(term)
  }
  return [...hit]
}
