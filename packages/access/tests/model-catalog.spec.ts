/**
 * model-catalog 纯函数层:llm-pi-ai 配置行→「视觉」索引提取;catalog 不可变富化。
 * 配置形状对构 pi-ai config(modelFields.input / modelOverrides / defaultInput)。
 */
import { describe, expect, it } from 'vitest'
import { enrichModelCatalog, visionIndexFromConfigEditor, VISION_BADGE } from '../src/model-catalog.ts'

describe('visionIndexFromConfigEditor', () => {
  it('提取:显式 input 胜、defaultInput 只兜真未知、非 pi-ai 行不采', () => {
    const index = visionIndexFromConfigEditor({
      entries: [
        // 非承载行:同形状配置也不采(只认 llm-pi-ai)
        { entry: { options: { id: 'other-row' } }, override: { providers: { rogue: { models: [{ id: 'x', input: ['image'] }] } } } },
        { entry: { options: { id: 'llm-pi-ai' } }, override: { providers: {
          litellm: {
            defaultInput: ['text'],
            models: [
              { id: 'm-text', input: ['text'] },
              { id: 'm-vision', input: ['text', 'image'] },
              { id: 'm-inherit' }, // 缺 input=schemastery 物化 [] 的「继承目录」语义 → 落 defaultInput
            ],
            modelOverrides: { 'm-catalog': { input: ['image'] }, 'm-catalog-empty': { input: [] } },
          },
          other: { models: [{ id: 'o-vision', input: ['image'] }] },
        } } },
      ],
    })
    expect([...index.keys()].sort()).toEqual(['litellm', 'other'])
    expect(index.get('litellm')!).toEqual(new Set(['m-vision', 'm-catalog']))
    expect(index.get('other')!).toEqual(new Set(['o-vision']))
  })

  it('defaultInput 含 image 时未知面打标;畸形配置逐级容忍不炸', () => {
    const index = visionIndexFromConfigEditor({
      entries: [{ entry: { options: { id: 'llm-pi-ai' } }, override: { providers: {
        route: { defaultInput: ['text', 'image'], models: [{ id: 'a' }, { id: 'b', input: [] }] },
      } } }],
    })
    // a 缺 input 继承路由声明;b 显式空=「继承」同语义,一并落 defaultInput
    expect(index.get('route')!).toEqual(new Set(['a', 'b']))
    expect(visionIndexFromConfigEditor(null).size).toBe(0)
    expect(visionIndexFromConfigEditor(undefined).size).toBe(0)
    expect(visionIndexFromConfigEditor({ entries: 'junk' }).size).toBe(0)
    expect(visionIndexFromConfigEditor({ entries: [{ entry: { options: { id: 'llm-pi-ai' } }, override: {} }] }).size).toBe(0)
    expect(visionIndexFromConfigEditor({ entries: [{ entry: { options: { id: 'llm-pi-ai' } }, override: { providers: { broken: null, ghost: 'x' } } }] }).size).toBe(0)
  })
})

describe('enrichModelCatalog', () => {
  interface SpecModel { readonly id: string; readonly name: string; readonly badge?: unknown }
  interface SpecCatalog {
    readonly default: { readonly provider: string; readonly model: string }
    readonly routableProviders: readonly string[]
    readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[]
    readonly groups: readonly { readonly id: string; readonly name: string; readonly models: readonly SpecModel[] }[]
  }

  it('只补缺;provider 自带 badge/failures/default 未触字段原样;上游值不被变异', () => {
    const catalog: SpecCatalog = {
      default: { provider: 'litellm', model: 'v1' },
      routableProviders: ['litellm'],
      failures: [{ id: 'ghost', name: 'ghost', message: 'no key' }],
      groups: [{ id: 'litellm', name: 'gw', models: [
        { id: 'v1', name: 'Vision One' },
        { id: 't1', name: 'Text One' },
        { id: 'p1', name: 'Provider Badged', badge: { text: '官方', tone: 'info' } },
      ] }],
    }
    const index = new Map([['litellm', new Set(['v1', 'p1'])]])
    const out = enrichModelCatalog(catalog, index)
    expect(out).not.toBe(catalog) // 触路径有拷贝
    expect(out.groups[0]!.models[0]!.badge).toEqual(VISION_BADGE)
    expect(out.groups[0]!.models[1]!.badge).toBeUndefined()
    // provider 自带 badge(官方 listing 来源)不覆盖
    expect(out.groups[0]!.models[2]!.badge).toEqual({ text: '官方', tone: 'info' })
    // 未触容器引用原样(结构性共享,不深拷贝)
    expect(out.failures).toBe(catalog.failures)
    expect(out.default).toBe(catalog.default)
    expect(out.groups[0]!.models).not.toBe(catalog.groups[0]!.models)
    // 输入对象永不变异
    expect(catalog.groups[0]!.models[0]!).not.toHaveProperty('badge')
  })

  it('空索引/缺 groups=引用原样返回(纯透传退化)', () => {
    const catalog = { groups: [{ id: 'g', models: [{ id: 'm' }] }] }
    expect(enrichModelCatalog(catalog, new Map())).toBe(catalog)
    expect(enrichModelCatalog({}, new Map([['g', new Set(['m'])]]))).toEqual({})
  })
})
