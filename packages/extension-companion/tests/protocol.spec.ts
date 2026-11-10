import { describe, expect, it } from 'vitest'
import { isEligibleUrl, PROTO_VERSION } from '../src/protocol'

describe('不可操作目标判定（红线 7）', () => {
  it('普通 http/https 可操作', () => {
    expect(isEligibleUrl('https://example.com/')).toBe(true)
    expect(isEligibleUrl('http://localhost:3000/app')).toBe(true)
  })

  it('空地址与 about:blank 可操作', () => {
    expect(isEligibleUrl('')).toBe(true)
    expect(isEligibleUrl('about:blank')).toBe(true)
  })

  it('浏览器内部页与商店不可操作', () => {
    expect(isEligibleUrl('chrome://settings/')).toBe(false)
    expect(isEligibleUrl('chrome-extension://abcdef/popup.html')).toBe(false)
    expect(isEligibleUrl('edge://version')).toBe(false)
    expect(isEligibleUrl('about:flags')).toBe(false)
    expect(isEligibleUrl('devtools://devtools/bundled/inspector.html')).toBe(false)
    expect(isEligibleUrl('https://chromewebstore.google.com/detail/foo')).toBe(false)
    expect(isEligibleUrl('https://chrome.google.com/webstore/category/extensions')).toBe(false)
  })

  it('前缀大小写不敏感', () => {
    expect(isEligibleUrl('CHROME://settings')).toBe(false)
  })
})

describe('协议版本', () => {
  it('冻结 v1', () => {
    expect(PROTO_VERSION).toBe(1)
  })
})
