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

/**
 * 已登记的公共面路由(铁律 T2 的唯一豁免口;映射文档 docs/PLUGIN-AUTHORING.md §1.3)。
 *
 * 豁免必须**精确到包 + 单次 register 调用内出现的路径字面量**:同一行既命中
 * register 又出现登记的 `path` 字面量才放行。禁止通配——否则任何插件只要在
 * 注册行旁边捎带一个已登记路径字符串就能绕过门禁(那等于把门禁改成后门)。
 *
 * 登记门槛(缺一不可):公开静态资源、无租户数据、无写操作、不加鉴权语义
 * (资源本身对所有访问者等价)。
 */
const PUBLIC_SURFACE_ROUTES: readonly { readonly pkg: string; readonly path: string }[] = [
  {
    pkg: 'brand',
    path: '/manifest.webmanifest',
    // PWA 清单:上游 fallback 静态面按通用文件路径原样返回(serveStatic 对
    // 非 index 文件无任何 transform 钩子),故只能以同路径 exact 路由接替做
    // 品牌化改写。内容为站点名/图标引用,不含任何用户或租户数据。
  },
]

/**
 * 从命中行起截取一次调用的文本块(register({ ... }) 通常跨行书写)。
 *
 * 行级扫描会让 `webServer.register({` 与 `path: '/manifest.webmanifest'`
 * 分处两行而互相看不见,故按花括号配平向后聚合;未闭合时最多看 12 行
 * (防御畸形源码把扫描拖成二次方)。
 *
 * @param lines - 源文件各行。
 * @param start - 命中行下标。
 * @returns 该调用块的拼接文本。
 */
function callBlock(lines: readonly string[], start: number): string {
  const first = lines[start] ?? ''
  const opened = (first.match(/\{/g) ?? []).length
  const closedOnFirst = (first.match(/\}/g) ?? []).length
  if (opened <= closedOnFirst) return first
  const parts: string[] = [first]
  let depth = opened - closedOnFirst
  for (let index = start + 1; index < lines.length && index < start + 12 && depth > 0; index++) {
    const line = lines[index] ?? ''
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    parts.push(line)
  }
  return parts.join('\n')
}

/**
 * 该调用是否为已登记公共面路由(精确匹配,不做子串放宽)。
 *
 * @param pkg - 包目录名(如 brand)。
 * @param block - 已剥注释的调用块文本。
 * @returns 命中登记的公共面即 true。
 */
function isRegisteredPublicSurface(pkg: string, block: string): boolean {
  return PUBLIC_SURFACE_ROUTES.some(route =>
    route.pkg === pkg
    && block.includes('.register(')
    && block.includes("kind: 'exact'")
    && block.includes(`path: '${route.path}'`))
}

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
        // T2:路由面独占(注释与文档不扫——已剥注释;测试文件豁免;
        // 已登记公共面 docs/PLUGIN-AUTHORING.md §1.3 逐条精确豁免)
        if (ROUTE_API_PATTERN.test(clean) && source.pkg !== GATEKEEPER_PACKAGE && !source.rel.includes('tests/')
          && !isRegisteredPublicSurface(source.pkg, callBlock(lines, index))) {
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
