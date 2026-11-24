/**
 * 回写条的契约单测(P6)。
 *
 * 这里的断言都围绕**产品承诺**,不是实现细节:
 *
 * 1. **两击确认只加在 followup 上**:inject 代价低,直接发;followup 会唤醒主会话
 *    并消耗一轮用量,第一击只武装、第二击才真发,3 秒无操作自动回落。
 * 2. **投递期间两个按钮都禁用**(防重复点击,AGENTS.md 铁律 3)。
 * 3. **空白正文不发**(不打服务端)。
 * 4. **失败不清空正文**(不让人白写一遍)、**成功才清空**。
 * 5. 错误码映射成面向用户的中文(401/404/503/429 各有专句)。
 *
 * 组件用 React 渲染函数直接求值会依赖 hooks 运行时,因此本文件**只测纯逻辑**
 * (确认态机 + 错误映射),组件层的装配由 client-bundle 的装载冒烟与浏览器 E2E 覆盖。
 * 确认态机的实现刻意写成可从组件里抽出的纯函数形态(见 feedbackMachine)。
 */
import { describe, expect, it } from 'vitest'
import { AdviserApiError } from '../src/client/api.ts'
import { describeDeliveryError, nextConfirmState } from '../src/client/feedback-machine.ts'

describe('二次确认态机(nextConfirmState)', () => {
  it('第一次点击只武装,不发送', () => {
    expect(nextConfirmState('idle')).toEqual({ action: 'arm', next: 'armed' })
  })

  it('已武装时再点才真发', () => {
    expect(nextConfirmState('armed')).toEqual({ action: 'send', next: 'idle' })
  })

  it('超时/改动正文后回到 idle(自动回落,不留永久武装的按钮)', () => {
    expect(nextConfirmState('armed', 'disarm')).toEqual({ action: 'none', next: 'idle' })
  })

  it('投递中不响应点击', () => {
    expect(nextConfirmState('sending')).toEqual({ action: 'none', next: 'sending' })
  })
})

describe('投递错误映射(describeDeliveryError)', () => {
  const t = (key: string): string => key

  it('带状态码的 API 错误各自映射到专句(用户能据此行动)', () => {
    expect(describeDeliveryError(new AdviserApiError(401, '未登录'), t)).toBe('feedback.error.unauthorized')
    expect(describeDeliveryError(new AdviserApiError(404, '主会话不存在'), t)).toBe('feedback.error.parentMissing')
    expect(describeDeliveryError(new AdviserApiError(503, '内核未就绪'), t)).toBe('feedback.error.unavailable')
    expect(describeDeliveryError(new AdviserApiError(429, '太快'), t)).toBe('feedback.error.rateLimited')
  })

  it('其它 4xx/5xx 用服务端消息(它已是中文)', () => {
    expect(describeDeliveryError(new AdviserApiError(400, '投递内容不能为空'), t)).toBe('投递内容不能为空')
  })

  it('非 API 异常(网络/CORS)降级为自身消息,不吞错', () => {
    expect(describeDeliveryError(new TypeError('Failed to fetch'), t)).toBe('Failed to fetch')
    expect(describeDeliveryError('boom', t)).toBe('boom')
  })
})
