/**
 * template-tool 纯函数核心测试(node --test)。
 * 口径与 golden wedding-plan-100p-300k 同源:检索命中婚礼全案模板,
 * 章节四章齐备(当日流程/分项预算/分工/预案)。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemplateTool, TEMPLATE_TOOL_SERVICE_ID } from './template-tool.ts'

const tool = createTemplateTool()

test('注册表 + 唯一 ID 形态(@event/template-tool)', () => {
  assert.equal(tool.id, TEMPLATE_TOOL_SERVICE_ID)
  assert.equal(TEMPLATE_TOOL_SERVICE_ID, '@event/template-tool')
})

test('golden 场景:「婚礼 策划案」命中全案模板且四章齐备', () => {
  const matches = tool.search('婚礼 策划案')
  assert.ok(matches.length > 0)
  const wedding = matches.find(match => match.template.id === 'wedding-plan-standard')
  assert.ok(wedding !== undefined, '婚礼全案模板应命中')
  assert.deepEqual([...wedding.template.sections], ['当日流程', '分项预算', '分工', '预案'])
})

test('计分排序:双词命中排在单词命中前', () => {
  const matches = tool.search('婚礼 户外')
  assert.ok(matches.length >= 2)
  assert.ok(matches[0].score >= matches[1].score)
})

test('类目过滤:category=比选 只返回比选模板', () => {
  const matches = tool.search('场地', { category: '比选' })
  assert.ok(matches.length > 0)
  for (const match of matches) assert.equal(match.template.category, '比选')
})

test('limit 截断与无命中空结果', () => {
  assert.equal(tool.search('婚礼', { limit: 1 }).length, 1)
  assert.deepEqual(tool.search('不存在的关键词xyz'), [])
})

test('byId 精确取模板', () => {
  assert.equal(tool.byId('venue-comparison-matrix').title, '场地比选对照表')
  assert.equal(tool.byId('nope'), undefined)
})
