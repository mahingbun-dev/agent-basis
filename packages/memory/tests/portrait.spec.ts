import { describe, expect, it } from 'vitest'
import { buildPortrait, PORTRAIT_MAX_PER_SECTION } from '../src/index.ts'
import type { DomainRecord, EntityRecord } from '../src/index.ts'

/** 固定时钟:画像内 generated_at 与检索分排序全部确定化。 */
const NOW = 1_760_000_000_000

function record(overrides: Partial<EntityRecord> & { key: string }): EntityRecord {
  return {
    id: 1,
    subject: 'user',
    content: '正文内容',
    summary: null,
    validAt: 1_000,
    invalidAt: null,
    confidence: 0.8,
    createdAt: 1_000,
    updatedAt: 1_000,
    kind: 'semantic',
    scope: 'user',
    domainKey: null,
    reviewState: 'approved',
    originSessionId: null,
    originTurnRef: null,
    source: 'agent',
    lastUsedAt: null,
    useCount: 0,
    ...overrides,
  }
}

function domain(overrides: Partial<DomainRecord> & { domainKey: string }): DomainRecord {
  return {
    label: '测试域',
    source: 'workspace',
    hitSessions: 0,
    registered: 1_000,
    sessionCount: 0,
    memoryCount: 0,
    lastUsedAt: null,
    createdAt: 1_000,
    ...overrides,
  }
}

/** 四分节标题顺序(18 §5:工作习惯/风格偏好/协作要求/工作区索引)。 */
const SECTION_TITLES = ['## 工作习惯', '## 风格偏好', '## 协作要求', '## 工作区索引'] as const

/** glue readPortraitCache 的 frontmatter 剥离正则(memory-plugin.ts 同款,钉住缓存契约)。 */
const FRONTMATTER_STRIP = /^---\n[\s\S]*?\n---\n?/u

describe('M-M1 T4 buildPortrait:user 层画像聚合(纯函数)', () => {
  it('过滤口径:只聚合 scope=user 且 approved 且 live 的 semantic 记录', () => {
    const text = buildPortrait(
      [
        record({ id: 7, key: 'prefers-chinese', summary: '偏好中文回复' }),
        record({ id: 8, key: 'domain-fact', summary: '域内事实', scope: 'domain', domainKey: 'default' }),
        record({ id: 9, key: 'episode', summary: '一次会话片段', kind: 'episodic' }),
        record({ id: 10, key: 'awaiting', summary: '待审偏好', reviewState: 'pending' }),
        record({ id: 11, key: 'superseded', summary: '已被顶替的旧值', invalidAt: 2_000 }),
      ],
      { now: () => NOW },
    )
    expect(text).toContain('偏好中文回复')
    expect(text).not.toContain('域内事实')
    expect(text).not.toContain('一次会话片段')
    expect(text).not.toContain('待审偏好')
    expect(text).not.toContain('已被顶替的旧值')
    // source_memory_ids 只含入选条目(可追溯到条)
    expect(text).toContain('source_memory_ids: [7]')
  })

  it('分节:要求类词入协作要求、偏好类词入风格偏好、其余入工作习惯;四节顺序固定', () => {
    const text = buildPortrait(
      [
        record({ id: 1, key: 'standup-time', content: '工作日早上十点参加站会' }),
        record({ id: 2, key: 'commit-style', content: '喜欢简洁的提交信息风格' }),
        record({ id: 3, key: 'reply-tone', content: '回复必须先给结论再展开' }),
      ],
      { now: () => NOW },
    )
    // 节标题按 18 §5 顺序出现
    const positions = SECTION_TITLES.map(title => text.indexOf(title))
    expect(positions.every(index => index >= 0)).toBe(true)
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]!)
    }
    // summary 缺省从 content 派生首句;行格式「key — 摘要」
    expect(text).toContain('- commit-style — 喜欢简洁的提交信息风格')
    // 各归其节:工作习惯段(首个节)不含后两条
    const habits = text.slice(text.indexOf('## 工作习惯'), text.indexOf('## 风格偏好'))
    expect(habits).toContain('standup-time')
    expect(habits).not.toContain('commit-style')
    expect(habits).not.toContain('reply-tone')
    const preferences = text.slice(text.indexOf('## 风格偏好'), text.indexOf('## 协作要求'))
    expect(preferences).toContain('commit-style')
    const requirements = text.slice(text.indexOf('## 协作要求'), text.indexOf('## 工作区索引'))
    expect(requirements).toContain('reply-tone')
  })

  it('frontmatter:version/generated_at/source_memory_ids 可追溯(id 升序)', () => {
    const text = buildPortrait(
      [record({ id: 7, key: 'a', summary: '甲' }), record({ id: 3, key: 'b', summary: '乙' })],
      { version: 4, now: () => NOW },
    )
    expect(text.startsWith('---\n')).toBe(true)
    expect(text).toContain('version: 4')
    expect(text).toContain(`generated_at: ${new Date(NOW).toISOString()}`)
    expect(text).toContain('source_memory_ids: [3, 7]')
  })

  it('version 非法值拒绝(fail-closed)', () => {
    expect(() => buildPortrait([], { version: 0 })).toThrow(RangeError)
    expect(() => buildPortrait([], { version: 1.5 })).toThrow(RangeError)
  })

  it('空 user 层输出空画像:四节占位、source_memory_ids 空、剥离 frontmatter 后正文非空(glue 缓存契约)', () => {
    const text = buildPortrait([], { now: () => NOW })
    expect(text).toContain('source_memory_ids: []')
    for (const title of SECTION_TITLES) expect(text).toContain(title)
    expect(text).toContain('(暂无)')
    // glue readPortraitCache 语义:剥离 frontmatter 后正文非空才注入画像区
    const body = text.replace(FRONTMATTER_STRIP, '').trim()
    expect(body.length).toBeGreaterThan(0)
    expect(body).toContain('## 工作习惯')
  })

  it(`单节上限 ${PORTRAIT_MAX_PER_SECTION} 条:超出按检索分截断并在节尾注明`, () => {
    expect(PORTRAIT_MAX_PER_SECTION).toBe(10)
    const records = Array.from({ length: 12 }, (_, index) =>
      record({ id: index + 1, key: `habit-${index}`, summary: `习惯${index}`, confidence: 1 - index * 0.01 }),
    )
    const text = buildPortrait(records, { now: () => NOW })
    // 前 10 条(confidence 最高的 habit-0..habit-9)入选
    expect(text.match(/^- habit-/gmu)?.length).toBe(10)
    expect(text).toContain('- habit-0 — 习惯0')
    expect(text).toContain('- habit-9 — 习惯9')
    expect(text).not.toContain('habit-10')
    expect(text).not.toContain('habit-11')
    expect(text).toContain('(另有 2 条按排序截断,未列出)')
    // source_memory_ids 只含入选条目:截断丢弃行不是画像来源
    expect(text).toContain('source_memory_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]')
  })

  it('节内排序:检索分高者在前(置信度主序 + 命中强化次序)', () => {
    // updatedAt 贴近 NOW,半衰期衰减≈1:检索分≈confidence + 0.1×min(use_count,10)/10
    const text = buildPortrait(
      [
        record({ id: 1, key: 'low-conf', summary: '低置信', confidence: 0.5, updatedAt: NOW - 1_000 }),
        record({ id: 2, key: 'high-conf', summary: '高置信', confidence: 1, updatedAt: NOW - 1_000 }),
        record({ id: 3, key: 'well-used', summary: '常用', confidence: 0.85, useCount: 10, updatedAt: NOW - 1_000 }),
        record({ id: 4, key: 'rarely-used', summary: '少用', confidence: 0.9, updatedAt: NOW - 1_000 }),
      ],
      { now: () => NOW },
    )
    const order = ['high-conf', 'well-used', 'rarely-used', 'low-conf'].map(key => text.indexOf(key))
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index]).toBeGreaterThan(order[index - 1]!)
    }
  })

  it('工作区索引:domain_registry 投影只取已转正域,呈现标签/域键/记忆条数', () => {
    const text = buildPortrait(
      [record({ id: 5, key: 'prefers-chinese', summary: '偏好中文回复' })],
      {
        now: () => NOW,
        domains: [
          domain({ domainKey: 'event-planning', label: '活动策划', memoryCount: 3 }),
          domain({ domainKey: 'fresh-candidate', label: '候选域', registered: null }),
        ],
      },
    )
    const workspace = text.slice(text.indexOf('## 工作区索引'))
    expect(workspace).toContain('- 活动策划(event-planning):记忆 3 条')
    expect(workspace).not.toContain('fresh-candidate')
  })

  it('工作区索引同样受单节上限约束:按最近使用截断并在节尾注明', () => {
    const domains = Array.from({ length: 12 }, (_, index) =>
      domain({ domainKey: `domain-${index}`, label: `域${index}`, lastUsedAt: 10_000 - index }),
    )
    const text = buildPortrait([], { now: () => NOW, domains })
    const workspace = text.slice(text.indexOf('## 工作区索引'))
    // 行格式「- 标签(域键):…」,以标签开头
    expect(workspace.match(/^- 域\d+\(domain-/gmu)?.length).toBe(10)
    expect(workspace).toContain('- 域0(domain-0):记忆 0 条')
    expect(workspace).not.toContain('domain-10')
    expect(workspace).not.toContain('domain-11')
    expect(workspace).toContain('(另有 2 个域按排序截断,未列出)')
  })
})
