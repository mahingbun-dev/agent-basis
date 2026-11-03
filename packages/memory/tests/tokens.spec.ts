import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../src/index.ts'

describe('estimateTokens(注入预算度量衡)', () => {
  it('空串与纯空白计 0', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('   \n\t ')).toBe(0)
  })

  it('纯 ASCII 可见字符按 4 字符/token 向上取整', () => {
    expect(estimateTokens('abcdefghij')).toBe(3) // ceil(10/4)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abc')).toBe(1)
  })

  it('CJK 字符按 1 token/字计', () => {
    expect(estimateTokens('记忆索引')).toBe(4)
  })

  it('中英混排分别计量后求和', () => {
    // 4 个 CJK(4 token)+ 8 个字母(2 token)= 6
    expect(estimateTokens('记忆索引abcdefgh')).toBe(6)
  })

  it('全角标点按 CJK 计', () => {
    expect(estimateTokens('，。')).toBe(2)
  })
})
