/**
 * tenant-scan(T3.4/T3.5):插件隔离铁律的静态检查器(扫描 packages/*)。
 *
 * 铁律(PLUGIN-AUTHORING「多租户与隔离」章节):
 *   T1 持久化必须在 DSH_HOME 语义之下 —— 禁源码硬编码容器/家目录绝对路径
 *      (/data、/root、os.tmpdir() 持久化);部署契约=working_dir 即 home,
 *      相对/cwd 基路径合规(audit 先例)。
 *   T2 禁止绕过门禁的路由面 —— webServer 各 register 方法、registerFallback、
 *      registerUpgrade、connection.fetch.register、connection.rpc.handle 与
 *      intercept 仅 @eterna/access(门禁本体)可调用;其余插件一律违规。
 *   T3 workspace 登记册独占写 —— 禁直写 storages/workspace.json(必须经
 *      workspaceController,守卫层才有记账点)。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { error, hasErrors, type Finding } from './types.ts'

const ROUTE_API_PATTERN = /webServer\.register|registerFallback|registerUpgrade|\.fetch\.register|\.rpc\.(handle|intercept)/
const WORKSPACE_REGISTRY_WRITE = /workspace\.json/
const ABSOLUTE_PERSIST_PATTERN = /['"`]\/(?:data|root|home|tmp)\//

const GATEKEEPER_PACKAGE = 'access'

interface SourceFile {
  readonly pkg: string
  readonly rel: string
  readonly text: string
}

function listSources(root: string, rel: string, out: SourceFile[]): void {
  const full = join(root, rel)
  const entries = readdirSync(full)
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'lib' || entry.startsWith('.')) continue
    const relPath = join(rel, entry)
    if (statSync(join(root, relPath)).isDirectory()) {
      listSources(root, relPath, out)
      continue
    }
    if (entry.endsWith('.ts') || entry.endsWith('.mjs') || entry.endsWith('.js')) {
      out.push({ pkg: rel.split('/')[0] ?? rel, rel: relPath, text: readFileSync(join(root, relPath), 'utf8') })
    }
  }
}

/** 对 packages/* 逐包扫描铁律违规;返回 findings(行号 1 基)。 */
export function tenantScan(repoRoot: string): readonly Finding[] {
  const packagesDir = join(repoRoot, 'packages')
  const findings: Finding[] = []
  for (const pkg of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, pkg)
    if (!statSync(pkgDir).isDirectory()) continue
    const sources: SourceFile[] = []
    try {
      listSources(packagesDir, pkg, sources)
    } catch {
      continue
    }
    for (const source of sources) {
      const lines = source.text.split('\n')
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? ''
        const clean = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
        const path = `${source.pkg}/${source.rel}:${index + 1}`
        // T2:路由面独占(注释与文档不扫——已剥注释;测试文件豁免)
        if (ROUTE_API_PATTERN.test(clean) && source.pkg !== GATEKEEPER_PACKAGE && !source.rel.includes('tests/')) {
          findings.push(error('tenant/route-escapes-gate', path, '插件不得自行注册 Web 路由/fetch 路由/rpc 通道——数据端点必须经 eterna-access 租户守卫(铁律 T2);确属公共面请登记映射文档并在 PR 说明'))
        }
        // T3:登记册独占写
        if (WORKSPACE_REGISTRY_WRITE.test(clean) && source.pkg !== GATEKEEPER_PACKAGE && !source.rel.includes('tests/')) {
          findings.push(error('tenant/workspace-registry-write', path, '禁止直读写 storages/workspace.json——workspace 增删必须经 workspaceController(铁律 T3)'))
        }
        // T1:硬编码容器绝对路径(测试文件豁免)
        if (ABSOLUTE_PERSIST_PATTERN.test(clean) && !source.rel.includes('tests/')) {
          findings.push(error('tenant/hardcoded-persist-path', path, '持久化路径禁止硬编码容器绝对路径——使用 $DSH_HOME/cwd 相对基路径(铁律 T1;部署契约 working_dir=home)'))
        }
      }
    }
  }
  return findings
}

export function tenantScanHasErrors(findings: readonly Finding[]): boolean {
  return hasErrors(findings)
}
