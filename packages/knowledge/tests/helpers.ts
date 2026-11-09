/**
 * 测试样例 wiki(真实落盘到临时目录;一页一文件,目录即命名空间)。
 *
 * 覆盖面:active/official、active/verified、stale、deprecated+superseded、仅 superseded(非 deprecated)、
 * agent_drafted 未过审(pending)、agent_drafted 已过审(reviewed)、坏页(解析失败,reindexAll 跳过)。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface SampleWiki {
  readonly wikiDir: string
  cleanup(): void
}

const PAGES: Record<string, string> = {
  'domains/venue-selection.md': `---
title: 场地选址指南
tags: [场地, 指南]
status: active
trust: official
source: 《活动策划手册 v3.2》第4章
created: 2026-08-01
updated: 2026-10-12
valid_at: 2026-10-12
last_verified: 2026-10-12
---
活动策划中的场地选址要素:容量、动线、预算与安全出口。目标场馆筛选见 [[场馆名录]]。

## Changelog

- 2026-10-12: 年度核验通过,结论不变
- 2026-08-01: 初版发布
`,
  'entities/venue-list.md': `---
title: 场馆名录
tags: [场馆]
status: active
trust: verified
source: 内部场馆合作台账
created: 2026-06-01
updated: 2026-09-20
last_verified: 2026-09-20
---
常用合作场馆清单:中心会展馆、滨江宴会厅、创意园区多功能厅。场地档期需提前 30 天确认。

## Changelog

- 2026-09-20: 新增创意园区多功能厅
`,
  'procedures/budget-plan.md': `---
title: 预算编制流程
tags: [预算]
status: active
trust: official
source: 《财务制度》§7
created: 2026-05-01
updated: 2026-10-01
last_verified: 2026-10-01
---
活动预算编制:先按场地、餐饮、物料三段拆分,再按 8% 计不可预见费。报销需附发票。

## Changelog

- 2026-10-01: 不可预见费比例自 10% 调整为 8%
`,
  'procedures/new-checkin.md': `---
title: 入场签到新流程
tags: [签到]
status: active
trust: verified
source: 运营部通知 2026-10
created: 2026-10-05
updated: 2026-10-05
---
入场签到统一改用电子核销二维码,提前一小时开场检票。

## Changelog

- 2026-10-05: 取代纸质签到流程
`,
  'procedures/old-checkin.md': `---
title: 入场签到旧流程(纸质)
tags: [签到]
status: deprecated
trust: official
superseded_by: procedures/new-checkin
source: 运营部通知 2024
created: 2024-03-01
updated: 2026-10-05
---
入场签到使用纸质名单人工勾选,现场领取胸牌。

## Changelog

- 2026-10-05: 废弃,由 procedures/new-checkin 取代
`,
  'archive/refund-policy-v1.md': `---
title: 退费政策 v1
tags: [退费]
status: stale
trust: official
superseded_by: finance/refund-policy-v2
source: 财务部 2023
created: 2023-01-01
updated: 2023-06-01
---
活动开始前 7 日可全额退费;7 日内退 50%。

## Changelog

- 2023-06-01: v1 生效
`,
  'domains/tax-rule-draft.md': `---
title: 大额发票税点新规(草稿)
tags: [税务]
status: active
trust: agent_drafted
source: 据称来自税务新规,待核
created: 2026-11-01
updated: 2026-11-01
---
大额发票税点调整为 3%,具体以专管员口径为准。

## Changelog

- 2026-11-01: agent 草稿,未过审
`,
  'domains/agent-review-notes.md': `---
title: 复盘笔记规范(已过审)
tags: [复盘]
status: active
trust: agent_drafted
review: reviewed
source: 项目复盘实践
created: 2026-09-01
updated: 2026-09-15
---
每次活动结束 3 日内完成复盘,记录到 changelog,并回填场馆名录评价。

## Changelog

- 2026-09-15: 评审通过(review: reviewed)
`,
  'bad/broken-page.md': `---
title: 坏页
status: deprecated
---
deprecated 但缺 superseded_by,解析必须失败。
`,
}

export function makeSampleWiki(): SampleWiki {
  const wikiDir = mkdtempSync(join(tmpdir(), 'eterna-knowledge-wiki-'))
  for (const [rel, content] of Object.entries(PAGES)) {
    mkdirSync(dirname(join(wikiDir, rel)), { recursive: true })
    writeFileSync(join(wikiDir, rel), content, 'utf8')
  }
  return {
    wikiDir,
    cleanup: () => {
      rmSync(wikiDir, { recursive: true, force: true })
    },
  }
}

/** 可见页 doc_id 集合(断言检索命中域时用)。 */
export const VISIBLE_DOC_IDS = [
  'domains/venue-selection',
  'entities/venue-list',
  'procedures/budget-plan',
  'procedures/new-checkin',
  'domains/agent-review-notes',
] as const

export const HIDDEN_DOC_IDS = [
  'procedures/old-checkin', // deprecated + superseded
  'archive/refund-policy-v1', // superseded(非 deprecated,同样过期不可见)
  'domains/tax-rule-draft', // agent_drafted 未过审
] as const
