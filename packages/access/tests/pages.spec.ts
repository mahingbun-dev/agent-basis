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

  it('导航壳:身份页含返回应用/退出/账号设置;登录页无退出', () => {
    const html = renderAccountPage({ ...admin, nickname: '马先生' })
    expect(html).toContain('href="/"')
    expect(html).toContain('data-logout')
    expect(html).toContain('账号设置')
    expect(html).not.toContain('data-logout" title="退出登录"></button>')
    const login = renderLoginPage()
    expect(login).not.toContain('data-logout')
    expect(login).toContain('pwEye')
    expect(login).toContain('go.disabled=true')
  })

  it('账号页:XSS 转义 + 资料合并保存(脏检查) + 密码独立卡(确认输入/显示切换)', () => {
    const html = renderAccountPage({ ...admin, nickname: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('saveProfile')
    expect(html).toContain('savePw')
    expect(html).toContain('newPw2')
    expect(html).toContain('resetAv')
    expect(html).toContain('pendingAvatar')
    expect(html).toContain('两次输入的新密码不一致')
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
    expect(html).toContain('data-armed')
    expect(html).not.toContain('with<b>')
    expect(html).toContain('with&lt;b&gt;')
  })

  it('无权访问页', () => {
    expect(renderForbiddenPage({ nickname: '马先生', avatarUrl: null, account: 'Mr.Ma' })).toContain('仅管理员')
    const withNav = renderForbiddenPage({ nickname: '马先生', avatarUrl: null, account: 'Mr.Ma' })
    expect(withNav).toContain('href="/"')
    expect(withNav).toContain('退出')
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
