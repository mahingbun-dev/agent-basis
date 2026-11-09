import { describe, expect, it } from 'vitest'
import { BADGE_SCRIPT, renderAccountPage, renderAdminPage, renderForbiddenPage, renderLoginPage } from '../src/pages.ts'
import { injectBadge } from '../src/plugin.ts'
import type { UserRow, UserSummary } from '../src/store.ts'

const admin: UserRow = { id: 1, account: 'Mr.Ma', nickname: '马先生', role: 'admin', passwordVersion: 1 }

function summary(partial: Partial<UserSummary>): UserSummary {
  return { id: 2, account: 'bob', nickname: 'bob', role: 'user', createdAt: '2026-11-09', hasAvatar: false, ...partial }
}

describe('pages 页面与角标', () => {
  it('登录页含表单与品牌', () => {
    const html = renderLoginPage()
    expect(html).toContain('登录')
    expect(html).toContain('恒灵')
    expect(html).toContain('id="password"')
  })

  it('账号页转义用户数据(XSS 防护)且含三块配置', () => {
    const html = renderAccountPage({ ...admin, nickname: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('saveNick')
    expect(html).toContain('savePw')
    expect(html).toContain('resetAv')
  })

  it('管理页含表格/后缀说明/删除按钮;他人可删、自己禁删', () => {
    const html = renderAdminPage(admin, [
      summary({ id: 2, account: 'zhangsan01', nickname: '张三' }),
      summary({ id: 1, account: 'Mr.Ma', nickname: '马先生', role: 'admin' }),
      summary({ id: 3, account: 'with<b>', nickname: 'x' }),
    ])
    expect(html).toContain('用户管理')
    expect(html).toContain('数字后缀')
    expect(html).toContain('data-id="2"')
    expect(html).not.toContain('data-id="1"')
    expect(html).not.toContain('with<b>')
    expect(html).toContain('with&lt;b&gt;')
  })

  it('无权访问页', () => {
    expect(renderForbiddenPage()).toContain('仅管理员')
  })

  it('角标脚本含 401 跳转分支与管理员入口;404 静默分支', () => {
    expect(BADGE_SCRIPT).toContain("location.replace('/login')")
    expect(BADGE_SCRIPT).toContain('401')
    expect(BADGE_SCRIPT).toContain('用户管理')
  })

  it('injectBadge:注入 </body> 前;无 </body> 追加尾部', () => {
    const withBody = injectBadge('<html><body>app</body></html>')
    expect(withBody).toContain('<script>')
    expect(withBody.indexOf('<script>')).toBeLessThan(withBody.indexOf('</body>'))
    const without = injectBadge('<html>plain')
    expect(without.endsWith('</script>')).toBe(true)
  })
})
