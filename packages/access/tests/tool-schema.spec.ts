/**
 * 工具参数 schema 归一化单测(2026-11-19 MiMo 400):裸 properties 映射收敛为
 * `{type:'object',properties,required}`;顶层 title/description 不再被当注解;
 * 属性级 required:true 上提到根 required;规范 schema 原样返回。
 */
import { describe, expect, it } from 'vitest'
import { normalizeToolParameters } from '../src/tool-schema.ts'

describe('normalizeToolParameters', () => {
  it('裸映射 → type/properties/required;顶层 title/description 变成属性名', () => {
    const out = normalizeToolParameters({
      title: { type: 'string', description: '标题' },
      description: { type: 'string', description: '描述' },
      plugin: { type: 'string', required: true, description: '目录' },
    })
    expect(out.type).toBe('object')
    expect(out.title).toBeUndefined()
    expect(out.description).toBeUndefined()
    expect(Object.keys(out.properties as Record<string, unknown>).sort()).toEqual(['description', 'plugin', 'title'])
    expect(out.required).toEqual(['plugin'])
    expect((out.properties as Record<string, Record<string, unknown>>).plugin?.required).toBeUndefined()
  })

  it('属性级 required:false 不上提、不保留', () => {
    const out = normalizeToolParameters({
      a: { type: 'string', required: false },
      b: { type: 'string' },
    })
    expect(out.required).toEqual([])
    expect((out.properties as Record<string, Record<string, unknown>>).a?.required).toBeUndefined()
  })

  it('规范 schema 原样返回(不重排/不增删)', () => {
    const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false }
    expect(normalizeToolParameters(schema)).toBe(schema)
  })

  it('type 字符串/数组与 $schema 均视为规范 schema', () => {
    const a = { type: 'string' }
    const b = { type: ['string', 'null'] }
    const c = { $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }
    expect(normalizeToolParameters(a)).toBe(a)
    expect(normalizeToolParameters(b)).toBe(b)
    expect(normalizeToolParameters(c)).toBe(c)
  })

  it('空映射/缺席 → 空对象 schema', () => {
    expect(normalizeToolParameters({})).toEqual({ type: 'object', properties: {}, required: [] })
    expect(normalizeToolParameters(undefined)).toEqual({ type: 'object', properties: {}, required: [] })
  })

  it('裸映射属性名恰好叫 type 且值为对象时仍按参数处理', () => {
    const out = normalizeToolParameters({ type: { type: 'string', description: '类型' } })
    expect(out.type).toBe('object')
    expect(Object.keys(out.properties as Record<string, unknown>)).toEqual(['type'])
  })
})
