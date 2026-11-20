/**
 * B14/T26/T27 接线防漂移(2026-11-20;54 §13.4 第 4 条「未接线不得宣称 B14 完成」)。
 *
 * 行为面由 mcp-personal-routes/runtime 两个 spec 覆盖;本文件只钉住 bootstrap
 * 调用点与依赖声明,防止后续重构把接线静默删掉(与 mcp-manager-drift 同纪律:
 * 源文本断言,失败信息直接指出缺哪一条)。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

describe('B14 个人 MCP:bootstrap 接线防漂移', () => {
  it('plugin.ts 装配配置/主密钥/runtime/路由(五端点经 fetch 注册)', () => {
    const plugin = read('plugin.ts')
    expect(plugin).toContain('resolveMcpPersonalConfig(')
    expect(plugin).toContain('loadMcpMasterKey(')
    expect(plugin).toContain('mountPersonalMcp(')
    expect(plugin).toContain('createMcpClientProbe(')
    expect(plugin).toContain('installMcpPersonalFetchRoutes(')
    // runtime 交给路由 deps(delete/disable 立即摘 scope)+ 登出钩子
    expect(plugin).toContain('runtime: mcpRuntime')
    expect(plugin).toContain('onLogout')
  })

  it('installMcpPersonalFetchRoutes 内部调用 registerMcpPersonalRoutes(登录门/信封统一)', () => {
    const source = read('mcp-personal.ts')
    expect(source).toContain('registerMcpPersonalRoutes(deps, register)')
    for (const route of ['catalog', 'list', 'upsert', 'delete', 'probe']) {
      expect(source).toContain('`${MCP_PERSONAL_PREFIX}/' + route + '`')
    }
    // 401/403 帧码与 tenant 守卫一致
    expect(source).toContain("code: 'tenant/unauthenticated'")
    expect(source).toContain("code: 'tenant/denied'")
  })

  it('store 构造器执行 user_version 0→1 迁移(两表)', () => {
    const store = read('store.ts')
    expect(store).toContain('migrateMcpPersonalSchema(this.db)')
    expect(store).toContain('CREATE TABLE IF NOT EXISTS mcp_personal_server')
    expect(store).toContain('CREATE TABLE IF NOT EXISTS mcp_personal_secret')
    expect(store).toContain('PRAGMA user_version = ${MCP_PERSONAL_SCHEMA_VERSION}')
  })

  it('runtime 的四个全局监听与 kill switch/限额/预算常量接线', () => {
    const runtime = read('mcp-personal-runtime.ts')
    for (const event of ['agent/created', 'agent/disposed', 'tools/pre-execute', 'tools/execute']) {
      expect(runtime).toContain(`'${event}'`)
    }
    expect(runtime).toContain('{ global: true }')
    expect(runtime).toContain('MCP_PERSONAL_MAX_CONNECTIONS')
    expect(runtime).toContain('MCP_PERSONAL_STARTUP_TIMEOUT_MS')
    expect(runtime).toContain('createRealScope')
    expect(runtime).toContain('mcpClientModule')
  })

  it('package.json 声明 dsh-mcp-client / dsh-scope 依赖(catalog)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['@deepseek-ai/dsh-mcp-client']).toBe('catalog:')
    expect(pkg.dependencies?.['@deepseek-ai/dsh-scope']).toBe('catalog:')
  })
})
