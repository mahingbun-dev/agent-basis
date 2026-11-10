import { describe, expect, it } from 'vitest'
import { BADGE_SCRIPT, renderLoginPage } from '../src/pages.ts'
import { injectBadge } from '../src/plugin.ts'

describe('登录页与门禁角标', () => {
  it('登录页:表单/品牌/原生密码输入/防重复', () => {
    const html = renderLoginPage()
    expect(html).toContain('登录')
    expect(html).toContain('恒灵')
    expect(html).toContain('id="password"')
    expect(html).not.toContain('pw-toggle')
    expect(html).toContain('go.disabled=true')
  })

  it('登录页不再含独立页入口(功能入口=设置弹窗)', () => {
    const html = renderLoginPage()
    expect(html).not.toContain('/manage')
    expect(html).not.toContain('/account')
  })

  it('角标:401 门禁跳转;分区链接已移除(入口=设置弹窗);退出在位', () => {
    expect(BADGE_SCRIPT).toContain("location.replace('/login')")
    expect(BADGE_SCRIPT).not.toContain('/account')
    expect(BADGE_SCRIPT).not.toContain('/admin/users')
    expect(BADGE_SCRIPT).toContain('退出')
  })

  it('injectBadge:注入 </body> 前;无 </body> 追加尾部', () => {
    const withBody = injectBadge('<html><body>app</body></html>')
    expect(withBody).toContain('<script>')
    expect(withBody.indexOf('<script>')).toBeLessThan(withBody.indexOf('</body>'))
    const without = injectBadge('<html>plain')
    expect(without.endsWith('</script>')).toBe(true)
  })
})
