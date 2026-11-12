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

  it('门禁脚本:401 跳转在位;右上角身份角标已移除(账户入口=侧栏底部账户菜单)', () => {
    expect(BADGE_SCRIPT).toContain("location.replace('/login')")
    expect(BADGE_SCRIPT).not.toContain('/account')
    expect(BADGE_SCRIPT).not.toContain('/admin/users')
    expect(BADGE_SCRIPT).not.toContain('eterna-identity-badge')
    expect(BADGE_SCRIPT).not.toContain('退出')
  })

  it('门禁脚本:租户引导条+首屏落座兜底在位(拒绝监听/惰性输入框检测/点自己工作区行)', () => {
    expect(BADGE_SCRIPT).toContain('tenant/denied')
    expect(BADGE_SCRIPT).toContain('composerInert')
    expect(BADGE_SCRIPT).toContain('[aria-label="选择工作区"]')
    expect(BADGE_SCRIPT).toContain('recoverSeat')
    expect(BADGE_SCRIPT).toContain('scheduleRecover')
  })

  it('injectBadge:注入 </body> 前;无 </body> 追加尾部', () => {
    const withBody = injectBadge('<html><body>app</body></html>')
    expect(withBody).toContain('<script>')
    expect(withBody.indexOf('<script>')).toBeLessThan(withBody.indexOf('</body>'))
    const without = injectBadge('<html>plain')
    expect(without.endsWith('</script>')).toBe(true)
  })
})
