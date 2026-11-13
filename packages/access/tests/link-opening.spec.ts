/**
 * 「网页链接默认打开方式」联动单测：判定纯函数 + 装载编排（冻结语义）。
 * 上游出厂默认 sidebar；本联动只在「已生成令牌 + 自己扩展在线 + 从未显式选择」
 * 三条同时成立时写 new-tab，其余一律不动（见 link-opening.ts 头注）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  installLinkOpeningDefault,
  relayBaseFromGuideUrl,
  shouldDefaultLinkToBrowser,
  type ChatSettingsLike,
} from '../src/client/link-opening.ts'

describe('link-opening:shouldDefaultLinkToBrowser', () => {
  it('三条件齐备才翻:令牌+扩展在线+未显式选择', () => {
    expect(shouldDefaultLinkToBrowser({ stored: undefined, token: 'ec-1', tokenConnected: true })).toBe(true)
    expect(shouldDefaultLinkToBrowser({ stored: null, token: 'ec-1', tokenConnected: true })).toBe(true)
  })

  it('用户显式选过(含选回 sidebar)一律尊重', () => {
    expect(shouldDefaultLinkToBrowser({ stored: 'sidebar', token: 'ec-1', tokenConnected: true })).toBe(false)
    expect(shouldDefaultLinkToBrowser({ stored: 'new-tab', token: 'ec-1', tokenConnected: true })).toBe(false)
  })

  it('令牌缺失或扩展离线/探测失败不翻', () => {
    expect(shouldDefaultLinkToBrowser({ stored: undefined, token: null, tokenConnected: true })).toBe(false)
    expect(shouldDefaultLinkToBrowser({ stored: undefined, token: 'ec-1', tokenConnected: false })).toBe(false)
    expect(shouldDefaultLinkToBrowser({ stored: undefined, token: 'ec-1', tokenConnected: undefined })).toBe(false)
  })
})

describe('link-opening:relayBaseFromGuideUrl', () => {
  it('剥离 /companion/guide 后缀得基址;无后缀原样返回(编排侧跳过)', () => {
    expect(relayBaseFromGuideUrl('https://relay.example.com/r/companion/guide')).toBe('https://relay.example.com/r')
    expect(relayBaseFromGuideUrl('http://127.0.0.1:9310/companion/guide')).toBe('http://127.0.0.1:9310')
    expect(relayBaseFromGuideUrl('https://x.example.com/')).toBe('https://x.example.com/')
  })
})

function fakeChatSettings(stored: unknown): ChatSettingsLike & { writes: Array<{ field: string; value: unknown }> } {
  const writes: Array<{ field: string; value: unknown }> = []
  return {
    writes,
    getSnapshot: () => ({ value: stored === 'NO_DOC' ? undefined : { ...(stored !== undefined ? { linkOpening: stored } : {}) } }),
    set: async (field, value) => {
      writes.push({ field, value })
      return true
    },
  }
}

describe('link-opening:installLinkOpeningDefault', () => {
  it('三条件齐备 → 写 ui-chat.linkOpening=new-tab', async () => {
    const settings = fakeChatSettings(undefined)
    await installLinkOpeningDefault({
      companion: async () => ({ token: 'ec-1', guideUrl: 'https://r.example.com/companion/guide' }),
      status: async (relayBase, token) => {
        expect(relayBase).toBe('https://r.example.com')
        expect(token).toBe('ec-1')
        return { tokenConnected: true }
      },
      chatSettings: settings,
    })
    expect(settings.writes).toEqual([{ field: 'linkOpening', value: 'new-tab' }])
  })

  it('显式选择/离线/未生成令牌/指引页异常 → 不写', async () => {
    const status = vi.fn(async () => ({ tokenConnected: true }))
    const cases: Array<[unknown, string | null]> = [
      ['sidebar', 'ec-1'], // 显式选择:不探测不写
      [undefined, null], // 未生成令牌:不探测不写
    ]
    for (const [stored, token] of cases) {
      const settings = fakeChatSettings(stored)
      await installLinkOpeningDefault({
        companion: async () => ({ token, guideUrl: 'https://r.example.com/companion/guide' }),
        status,
        chatSettings: settings,
      })
      expect(settings.writes).toEqual([])
    }
    expect(status).not.toHaveBeenCalled()
  })

  it('companion/探测任一环抛错 → 静默吞掉,不外抛', async () => {
    const settings = fakeChatSettings(undefined)
    await expect(installLinkOpeningDefault({
      companion: async () => { throw new Error('network down') },
      status: async () => ({}),
      chatSettings: settings,
    })).resolves.toBeUndefined()
    await expect(installLinkOpeningDefault({
      companion: async () => ({ token: 'ec-1', guideUrl: 'https://r.example.com/companion/guide' }),
      status: async () => { throw new Error('relay down') },
      chatSettings: settings,
    })).resolves.toBeUndefined()
    expect(settings.writes).toEqual([])
  })

  it('等待探测期间用户显式选择 → 以最新存储值为准,不覆盖', async () => {
    let current: unknown = undefined
    const settings: ChatSettingsLike & { writes: unknown[] } = {
      writes: [],
      getSnapshot: () => ({ value: current === undefined ? {} : { linkOpening: current } }),
      set: async (_field, value) => {
        current = value
        return true
      },
    }
    await installLinkOpeningDefault({
      companion: async () => ({ token: 'ec-1', guideUrl: 'https://r.example.com/companion/guide' }),
      status: async () => {
        current = 'sidebar' // 探测返回前用户手动选了侧边栏
        return { tokenConnected: true }
      },
      chatSettings: settings,
    })
    expect(settings.writes).toEqual([])
  })
})
