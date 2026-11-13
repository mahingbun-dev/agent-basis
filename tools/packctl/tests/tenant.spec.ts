import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tenantScan } from '../src/tenant.ts'

/** 构造最小包骨架:pkg/src/<file> 源文件(含子目录);内容即待扫描文本。 */
function makeRepo(dir: string, pkg: string, file: string, text: string): string {
  const target = join(dir, 'packages', pkg, 'src', file)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, text, 'utf8')
  return dir
}

describe('packctl tenant-scan 铁律', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'packctl-tenant-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('T2 路由面独占:非 access 包注册 Web 路由/fetch 路由即违规;access 包豁免;测试文件豁免', () => {
    makeRepo(dir, 'eterna-rogue', 'index.ts', "const d = ctx.webServer.register({ kind: 'exact', path: '/x', handler })\n")
    makeRepo(dir, 'eterna-rogue2', 'bridge.ts', "ctx.connection.fetch.register({ path: '/api/x', fetch })\n")
    makeRepo(dir, 'access', 'plugin.ts', "ctx.webServer.register({ kind: 'exact', path: '/login', handler })\n")
    makeRepo(dir, 'eterna-ok', join('tests', 'route.spec.ts'), 'expect(() => ctx.webServer.register(route)).toThrow()\n')
    const findings = tenantScan(dir)
    const codes = findings.map(f => f.code)
    expect(codes.filter(c => c === 'tenant/route-escapes-gate')).toHaveLength(2)
  })

  it('T3 登记册独占写:非 access 包直写 workspace.json 即违规', () => {
    makeRepo(dir, 'eterna-rogue', 'store.ts', "const ws = JSON.parse(readFileSync('/data/storages/workspace.json', 'utf8'))\n")
    const findings = tenantScan(dir)
    expect(findings.map(f => f.code)).toContain('tenant/workspace-registry-write')
  })

  it('T1 持久化:硬编码 /data 与 /root 绝对路径违规;/tmp 注入路径亦违规;cwd 相对合规', () => {
    makeRepo(dir, 'eterna-bad', 'persist.ts', "const file = '/data/myplugin/state.json'\nconst home = '/root/x'\nconst scratch = join(os.tmpdir(), 'state')\n")
    makeRepo(dir, 'audit', 'plugin.ts', "const dir = join(process.cwd(), '.eterna')\n")
    const findings = tenantScan(dir)
    expect(findings.filter(f => f.code === 'tenant/hardcoded-persist-path').length).toBeGreaterThanOrEqual(2)
  })

  it('注释不含规则命中(纯文档行不误报)', () => {
    makeRepo(dir, 'eterna-doc', 'index.ts', '// 参考:上游用 webServer.registerFallback 做 SPA 服务\nexport const x = 1\n')
    expect(tenantScan(dir)).toHaveLength(0)
  })

  it('T2 公共面豁免:仅 brand + /manifest.webmanifest + exact 精确放行', () => {
    // 跨行书写(真实形态):register 与 path 分处两行,靠调用块聚合识别
    makeRepo(dir, 'brand', 'index.ts', [
      'disposers.push(webServer.register({',
      "  kind: 'exact',",
      "  path: '/manifest.webmanifest',",
      '  resource: createManifestResource(file),',
      '}))',
    ].join('\n'))
    expect(tenantScan(dir)).toHaveLength(0)
  })

  it('T2 公共面豁免不得被滥用:错包/错路径/非 exact 一律仍违规', () => {
    // 同一路径但非登记包 → 违规
    makeRepo(dir, 'eterna-rogue', 'index.ts', "ctx.webServer.register({ kind: 'exact', path: '/manifest.webmanifest', handler })\n")
    // 同包但换路径 → 违规
    makeRepo(dir, 'brand2', 'evil.ts', "const a = ctx.webServer.register({ kind: 'exact', path: '/api/users', handler })\n")
    // 登记包 + 登记路径但非 exact(prefix 覆盖任意子面)→ 违规
    makeRepo(dir, 'brand', 'prefix.ts', "ctx.webServer.register({ kind: 'prefix', path: '/manifest.webmanifest', handler })\n")
    // 登记包 + 登记路径但走 fallback(抢占全局 fallback seat)→ 违规
    makeRepo(dir, 'brand3', 'fb.ts', "ctx.webServer.registerFallback({ path: '/manifest.webmanifest' })\n")
    const findings = tenantScan(dir)
    const routes = findings.filter(f => f.code === 'tenant/route-escapes-gate')
    expect(routes.length).toBeGreaterThanOrEqual(4)
  })
})
