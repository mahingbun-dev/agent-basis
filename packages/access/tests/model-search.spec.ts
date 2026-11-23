/**
 * 模型菜单模糊搜索(纯逻辑回归钉,2026-11-23)。
 *
 * 锁死三条语义:只匹配展示名、子序列多词、空查询不过滤;
 * 以及键盘高亮的环绕步进。任何一个放松都会让用户「搜到了不该出现的模型」
 * 或「明明有模型却搜不到」。
 */
import { describe, expect, it } from 'vitest'
import { filterModels, fuzzyMatch, normalizeQuery, stepIndex } from '../src/client/model-search.ts'

const MODELS = [
  { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' },
  { id: 'deepseek-v4.1-flash-eco', name: 'deepseek-v4.1-flash-eco' },
  { id: 'glm-5.3-flash', name: 'glm-5.3-flash' },
  { id: 'mystery-model', name: '显示名与 id 不同' },
] as const

describe('fuzzyMatch', () => {
  it('空查询恒真(菜单不过滤)', () => {
    expect(fuzzyMatch('deepseek-v4-pro', '')).toBe(true)
    expect(fuzzyMatch('deepseek-v4-pro', '   ')).toBe(true)
  })

  it('大小写不敏感、首尾空白忽略', () => {
    expect(fuzzyMatch('DeepSeek-V4-Pro', '  PRO ')).toBe(true)
    expect(fuzzyMatch('deepseek', 'DEEPSEEK')).toBe(true)
  })

  it('不连续子序列也命中(v41f → deepseek-v4.1-flash)', () => {
    expect(fuzzyMatch('deepseek-v4.1-flash', 'v41f')).toBe(true)
  })

  it('字符顺序不符不命中(不做事后重排)', () => {
    expect(fuzzyMatch('deepseek-v4.1-flash', 'flash4')).toBe(false)
  })

  it('多词查询每个词都必须命中', () => {
    expect(fuzzyMatch('deepseek-v4.1-flash-eco', 'deep eco')).toBe(true)
    expect(fuzzyMatch('deepseek-v4.1-flash-eco', 'deep glm')).toBe(false)
  })
})

describe('filterModels', () => {
  it('空查询返回原列表(同一引用,不复制)', () => {
    expect(filterModels(MODELS, '')).toBe(MODELS)
  })

  it('只匹配展示名,不命中 id(上游修正:不得按模型值命中)', () => {
    const hit = filterModels(MODELS, 'mystery')
    expect(hit).toHaveLength(0)
    expect(filterModels(MODELS, '显示名')).toHaveLength(1)
  })

  it('保持目录原顺序(搜索不重排行位)', () => {
    const hit = filterModels(MODELS, 'flash')
    expect(hit.map(m => m.id)).toStrictEqual([
      'deepseek-v4.1-flash',
      'deepseek-v4.1-flash-eco',
      'glm-5.3-flash',
    ])
  })

  it('子序列命中多个(eco 限定)', () => {
    expect(filterModels(MODELS, 'flasheco').map(m => m.id)).toStrictEqual(['deepseek-v4.1-flash-eco'])
  })

  it('无命中返回空数组', () => {
    expect(filterModels(MODELS, 'claude')).toHaveLength(0)
  })
})

describe('normalizeQuery', () => {
  it('trim + 小写', () => {
    expect(normalizeQuery('  GLM ')).toBe('glm')
  })
})

describe('stepIndex', () => {
  it('空列表恒 null', () => {
    expect(stepIndex(null, 1, 0)).toBeNull()
  })

  it('无高亮时:下键落首个、上键落末个', () => {
    expect(stepIndex(null, 1, 3)).toBe(0)
    expect(stepIndex(null, -1, 3)).toBe(2)
  })

  it('有高亮时环绕移动', () => {
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(1, 1, 3)).toBe(2)
  })

  it('越界高亮按无高亮处理(过滤后长度收缩)', () => {
    expect(stepIndex(5, 1, 2)).toBe(0)
    expect(stepIndex(5, -1, 2)).toBe(1)
  })
})
