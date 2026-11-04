/**
 * vendor-registry 纯函数核心测试(node --test)。
 * 口径与 golden venue-compare-3-quotes 同源:三家全列、统一口径折算到含 AV
 * 总价再比(开元 8.8 万含 AV / 洲际 10.2 万 + AV 1.2 万 = 11.4 万 / 万豪 9.5 万含 AV),
 * 排序键只有可比价(比选中立),来源可追溯。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVendorRegistry,
  VENDOR_TOOL_SERVICE_ID,
  VENUE_CATALOG,
  comparableVenueTotal,
  searchVenueCatalog,
} from './vendor-registry.ts'

test('注册表 + 唯一 ID 形态(@event/vendor-registry)', () => {
  const registry = createVendorRegistry()
  assert.equal(registry.id, VENDOR_TOOL_SERVICE_ID)
  assert.equal(VENDOR_TOOL_SERVICE_ID, '@event/vendor-registry')
})

test('neutralTable:统一口径(含 AV)折算后升序,排序键只有可比价', () => {
  const table = createVendorRegistry()
    .recordQuote({ vendor: '洲际厅', category: '场地', totalCny: 102000, includesAv: false, avExtraCny: 12000, source: '报价单 B-2210' })
    .recordQuote({ vendor: '开元厅', category: '场地', totalCny: 88000, includesAv: true, source: '报价单 A-1041' })
    .recordQuote({ vendor: '万豪厅', category: '场地', totalCny: 95000, includesAv: true, source: '报价单 C-0778' })
    .neutralTable()
  assert.deepEqual(table.map(row => row.vendor), ['开元厅', '万豪厅', '洲际厅'])
  assert.deepEqual(table.map(row => row.comparableTotalCny), [88000, 95000, 114000])
  for (const row of table) assert.ok(row.source.length > 0)
})

test('comparableVenueTotal:不含 AV 报价计入 AV 差价', () => {
  assert.equal(comparableVenueTotal({ name: '洲际厅', district: '市中心', capacity: 480, quoteCny: 102000, includesAv: false, avExtraCny: 12000, source: 'x' }), 114000)
  assert.equal(comparableVenueTotal({ name: '开元厅', district: '市中心', capacity: 520, quoteCny: 88000, includesAv: true, source: 'x' }), 88000)
})

test('venue_search:golden 容量场景(≥500 人)三家全返回且来源齐全', () => {
  const hits = searchVenueCatalog({ capacityMin: 500 })
  const names = hits.map(hit => hit.venue.name)
  for (const hall of ['开元厅', '万豪厅']) assert.ok(names.includes(hall), `${hall} 应在容量过滤结果中`)
  assert.ok(hits.every(hit => hit.venue.source.length > 0))
})

test('venue_search:关键词命中场地名/区位', () => {
  assert.ok(searchVenueCatalog({ keyword: '开元' }).length >= 1)
  assert.deepEqual(searchVenueCatalog({ keyword: '不存在xyz' }), [])
})

test('venue_search:统一口径可比价随命中返回(洲际 11.4 万 > 万豪 9.5 万)', () => {
  const hit = searchVenueCatalog({ keyword: '洲际' })[0]
  assert.equal(hit.comparableTotalCny, 114000)
})

test('内置场地库:至少六家、容量/报价字段完备', () => {
  assert.ok(VENUE_CATALOG.length >= 6)
  for (const venue of VENUE_CATALOG) {
    assert.ok(venue.capacity > 0)
    assert.ok(venue.quoteCny > 0)
    assert.ok(venue.source.length > 0)
  }
})
