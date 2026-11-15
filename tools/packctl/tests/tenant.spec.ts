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

/** 按仓库真实相对路径精确落文件(T4 派生锚不在 src/ 下,如 scripts/gen-portrait.mjs)。 */
function makeFile(dir: string, relPath: string, text: string): string {
  const target = join(dir, 'packages', relPath)
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

  it('T4 memory 物理分库:dbPath/portrait 派生逃逸 workspace 即违规(绝对路径兜底/../ 逃逸/tmpdir)', () => {
    makeRepo(dir, 'eterna-rogue', 'paths.ts', [
      "import { join } from 'node:path'",
      "const dbPath = config.dbPath ?? '/var/lib/eterna/memory.sqlite3'",
      "const portraitPath = join(cwd, '../shared/portrait.md')",
      "const scratchDb = join(os.tmpdir(), 'memory.sqlite3')",
      "const notesDir = join(cwd, 'NOTES')",
    ].join('\n'))
    const findings = tenantScan(dir).filter(f => f.code === 'tenant/memory-persist-escape')
    expect(findings).toHaveLength(3)
  })

  it('T4 workspace 派生合规:cwd 基 join + 与库同目录画像不误报(NOTES 等其余路径不在本规则面)', () => {
    makeRepo(dir, 'eterna-memoryish', 'plugin.ts', [
      'const cwd = process.cwd()',
      "const dbPath = config.dbPath ?? join(cwd, '.eterna/memory.sqlite3')",
      "const portraitPath = join(dirname(dbPath), 'portrait.md')",
      "const notesDir = config.notesDir ?? join(cwd, 'NOTES')",
    ].join('\n'))
    expect(tenantScan(dir).filter(f => f.code.startsWith('tenant/memory-'))).toHaveLength(0)
  })

  it('T4 派生锚 fail-closed:glue 包在场而默认派生不在 cwd 基 → 红(重构改道必须同步规则再对账)', () => {
    makeFile(dir, join('glue', 'src', 'plugins', 'memory-plugin.ts'),
      "const dbPath = config.dbPath ?? join(homedir(), '.eterna/memory.sqlite3')\n")
    const findings = tenantScan(dir).filter(f => f.code === 'tenant/memory-persist-anchor-missing')
    expect(findings.map(f => f.path)).toContain('glue/src/plugins/memory-plugin.ts')
  })

  it('T4 派生锚:glue/memory 的现行默认派生形态过检(cwd 基库 + 同目录画像 + M-T2 路由面)', () => {
    makeFile(dir, join('glue', 'src', 'plugins', 'memory-plugin.ts'), [
      'const cwd = process.cwd()',
      "const dbPath = config.dbPath ?? join(cwd, '.eterna/memory.sqlite3')",
      "const PORTRAIT_CACHE_FILENAME = 'portrait.md'",
      '...readPortraitCache(join(dirname(dbPath), PORTRAIT_CACHE_FILENAME)),',
      "provide2('eterna-memory-accounts', accountsFace),",
      'router = new MemoryAccountRouter({',
    ].join('\n'))
    makeFile(dir, join('memory', 'scripts', 'gen-portrait.mjs'), [
      "const dbPath = resolve(process.argv[2] ?? join(process.cwd(), '.eterna/memory.sqlite3'))",
      "const portraitPath = join(dirname(dbPath), 'portrait.md')",
    ].join('\n'))
    expect(tenantScan(dir)).toHaveLength(0)
  })

  it('T4 误报防护:模块相对导入(../src/portrait.ts)与注释行不判逃逸', () => {
    makeRepo(dir, 'eterna-ok', 'index.ts', [
      "import { buildPortrait } from '../src/portrait.ts'",
      "// 旧配置示例:dbPath: '/data/memory.sqlite3'(注释豁免)",
      'export const x = 1',
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
