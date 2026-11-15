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
 *   T4 memory 物理分库(M-M1 T5,19 §3-T5/18 §9.1)—— eterna-memory 的
 *      dbPath/portrait 必须落在 workspace 派生目录(部署契约 working_dir=
 *      $DSH_HOME,每用户工作区在其 workspaces/<账号>/ 下;测试 profile 的
 *      隔离目录经 config 注入,不在静态判定面)。静态可断言两面:
 *      a) 逃逸面:凡 dbPath/portrait 路径派生行混入绝对路径字面量、`..`
 *         逃逸段或 os.tmpdir() 基 → 违规;
 *      b) 派生锚(防漂移 fail-closed):glue 插件与画像生成脚本必须保留
 *         「cwd 基 + .eterna/memory.sqlite3 + 与库同目录 portrait.md」的
 *         默认派生形态——重构改道即红,同步规则再对账。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { error, hasErrors, type Finding } from './types.ts'

const ROUTE_API_PATTERN = /webServer\.register|registerFallback|registerUpgrade|\.fetch\.register|\.rpc\.(handle|intercept)/
const WORKSPACE_REGISTRY_WRITE = /workspace\.json/
const ABSOLUTE_PERSIST_PATTERN = /['"`]\/(?:data|root|home|tmp)\//

/**
 * T4 memory 持久化路径派生行:提及 dbPath/portrait 或库名/画像文件名本身,
 * 且构成/落地一个路径(join/resolve 调用、memory.sqlite3/portrait.md 文件名
 * 字面量或 tmpdir 基)。仅在派生行上判逃逸,普通引用(类型声明/传参)不扫
 * ——规则面收敛在「路径从哪来」;变量名不叫 dbPath 的逃逸同样落网。
 */
const MEMORY_PATH_LINE = /dbpath|portrait|memory\.sqlite3/i
const MEMORY_PATH_DERIVES = /join\(|resolve\(|memory\.sqlite3|portrait\.md|tmpdir\(\)/
/** 派生行禁出现的基:临时目录(与 T1 持久化纪律同源,mem 库绝不去 tmp)。 */
const MEMORY_PATH_TMPDIR = /tmpdir\(\)/
/** 派生行禁出现的绝对路径字面量(整个引号内串以 / 开头;cwd 基被顶掉即逃逸)。 */
const MEMORY_PATH_ABSOLUTE = /['"`]\/[\w.-]+(?:\/[\w.-]+)*['"`]/
/** 派生行禁出现的 `..` 逃逸段(字面量以 .. 开头,或路径中段含 /..)。 */
const MEMORY_PATH_ESCAPE = /['"`]\.\.(?:\/|\\|['"`])|\/\.\.(?:\/|['"`])/
/** 模块说明行(import/export … from '…'):相对说明符是代码组织,不是持久化路径。 */
const MODULE_SPECIFIER_LINE = /^\s*(?:import|export)\b/

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

/**
 * T4 派生锚(19 §3-T5/18 §9.1):eterna-memory 持久化默认派生的「在场证明」,
 * fail-closed 防漂移——dbPath 默认必须锚在 cwd(DSH_HOME 语义 working_dir)下
 * 的 .eterna/,portrait 恒与库同目录。锚片段缺席即红;确属改道(如派生基换
 * 经守卫分配的显式 workspace 路径)须连同本表与 docs/PLUGIN-AUTHORING.md §1.1
 * 一并再对账,不许静默绕过。包目录在场才核验(合成仓库只含部分包时不误报)。
 */
const MEMORY_PERSIST_ANCHORS: readonly {
  readonly pkg: string
  readonly file: string
  readonly requires: readonly string[]
}[] = [
  {
    pkg: 'glue',
    file: 'src/plugins/memory-plugin.ts',
    requires: [
      "join(cwd, '.eterna/memory.sqlite3')", // dbPath 默认 = cwd 基 .eterna/(配置注入的隔离目录走 config.dbPath,不在静态面)
      'dirname(dbPath)', // portrait 缓存与库同目录(19 §3-T4)
      "PORTRAIT_CACHE_FILENAME = 'portrait.md'",
    ],
  },
  {
    pkg: 'memory',
    file: 'scripts/gen-portrait.mjs',
    requires: [
      "join(process.cwd(), '.eterna/memory.sqlite3')", // 手动生成器同款 cwd 基默认
      "join(dirname(dbPath), 'portrait.md')", // 输出恒为与库同目录的 portrait.md
    ],
  },
]

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
        // T4:memory 持久化路径(dbPath/portrait)派生逃逸(测试文件豁免;
        // import/export 模块说明行豁免——相对说明符是代码组织,不是持久化路径)
        if (MEMORY_PATH_LINE.test(clean) && MEMORY_PATH_DERIVES.test(clean)
          && !source.rel.includes('tests/') && !MODULE_SPECIFIER_LINE.test(clean)) {
          const escapeKind = MEMORY_PATH_TMPDIR.test(clean) ? 'os.tmpdir() 基'
            : MEMORY_PATH_ABSOLUTE.test(clean) ? '绝对路径字面量'
              : MEMORY_PATH_ESCAPE.test(clean) ? '`..` 逃逸段' : ''
          if (escapeKind !== '') {
            findings.push(error('tenant/memory-persist-escape', path,
              `memory 持久化路径(dbPath/portrait)派生混入${escapeKind}——必须落在 workspace 派生目录:cwd 基 join 相对子路径(铁律 T4,18 §9.1;测试隔离目录走 config 注入,不在静态面)`))
          }
        }
      }
    }
    // T4 派生锚:memory 持久化默认派生的在场证明(本包目录在场才核验,防漂移)
    for (const anchor of MEMORY_PERSIST_ANCHORS) {
      if (anchor.pkg !== pkg) continue
      let text: string
      try {
        text = readFileSync(join(pkgDir, anchor.file), 'utf8')
      } catch {
        findings.push(error('tenant/memory-persist-anchor-missing', `${pkg}/${anchor.file}`,
          'memory 持久化派生锚文件缺失或不可读——T4 失锚即红:恢复 workspace 派生默认(cwd 基 .eterna/memory.sqlite3 + 与库同目录 portrait.md),或确属改道则同步 tenant.ts MEMORY_PERSIST_ANCHORS 与 docs/PLUGIN-AUTHORING.md §1.1 再对账'))
        continue
      }
      const missing = anchor.requires.filter(piece => !text.includes(piece))
      if (missing.length > 0) {
        findings.push(error('tenant/memory-persist-anchor-missing', `${pkg}/${anchor.file}`,
          `memory 持久化默认派生锚缺失(${missing.join(';')})——dbPath/portrait 必须落在 workspace 派生目录(铁律 T4,18 §9.1);确属改道则同步 tenant.ts MEMORY_PERSIST_ANCHORS 与 docs/PLUGIN-AUTHORING.md §1.1 再对账`))
      }
    }
  }
  return findings
}

export function tenantScanHasErrors(findings: readonly Finding[]): boolean {
  return hasErrors(findings)
}
