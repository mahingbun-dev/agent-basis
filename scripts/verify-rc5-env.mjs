#!/usr/bin/env node
/**
 * rc.5 ENV/API 静态门禁(51 号 §1 ENV-002/003/004/006 的「可静态检查部分」;
 * 54 号 §6.3 登记 `scripts/verify-rc5-env.mjs`,任务 T47)。
 *
 * 覆盖与口径:
 *   ENV-003  版本族:全仓 package.json(显式豁免 v1/ 与 vendor 的 core/)与
 *            pnpm-workspace.yaml catalog 统一 0.2.2-rc.5;cordis 4.1.0;
 *            cosmokit 1.9.0(51 号口径:根 devDeps + catalog + tools/packs/market,
 *            这里把 packages/* 的清单也纳入,免 v1/core 的豁免同任务口径)。
 *            硬门禁 = 任何 0.2.1 / 0.2.2-rc.1 /
 *            0.2.2-alpha.2|3 / 4.0.6 的**钉版**(精确、=、~、^);`>=` 形态的
 *            旧下限(仍允许 rc.5 解析)列为 stale-floor 命中(WARN,不阻断),因为
 *            它不再是「钉版」但会向消费方声明一个已不成立的兼容下限(LoggerLevel
 *            数值序 4.0.6→4.1.0 已反转,见 API-009)。
 *   ENV-002  全仓版本残留:按 51 号口径扫 0.2.2-alpha.2 / alpha.3 / rc.1,
 *            并补 0.2.1 / 4.0.6。排除历史文档(docs/、plans/、*.md)与锁文件
 *            (pnpm-lock.yaml)——51 号明文排除面。代码/配置里的**非注释**命中为
 *            硬门禁;注释里的命中记为 informational(历史叙述,不阻断),但全部
 *            列出以便收尾清理,不静默丢弃。
 *   ENV-006  Dockerfile:`npm i -g @deepseek-ai/dsh@` 必须精确 0.2.2-rc.5,
 *            有效行(RUN 体,去注释)不得出现 alpha.*;「只装 dsh,mcp-client 用
 *            宿主内嵌」(49 号 §4)另记一条 WARN,不单独阻断 ENV-006。
 *   ENV-004  静态代理:本仓 workspace 实装的 @deepseek-ai/dsh 版本 + Dockerfile
 *            钉版都为 rc.5 ⇒ 镜像构建产物会是 rc.5。
 *            **运行时半**(T48):加 `--runtime-image <tag>`(或 `--runtime-container
 *            <name>`)后,在镜像/容器内真跑断言:ENV-004 `dsh --version`=0.2.2-rc.5、
 *            ENV-005 `node -v`≥24.9 且根 package.json engines.node=≥24.9.0、
 *            symlink realpath 解析到 @deepseek-ai/dsh 且 mcp-client 同版(T37)、
 *            v1 剥离(运行层复核 core/、basis.yml、6 个 @basis 包)、OFF-004 字体
 *            三族、OFF-005 Python 三库、flock 存在、夹具不进镜像。不带参数时
 *            报告里仍显式标 runtime=not-run,不冒充通过。
 *
 * `--api-static` 追加两项静态验证(51 号 API-008/009):
 *   API-008  `new LlmError(...)` 构造签名:rc.5 为 (message, code, options?),
 *            code ∈ BuiltinLlmFailureCode;旧的单参/对象形态 = 残留。同时统计
 *            `LlmError.fromFailure(...)` 的出点(provider 码透传走它)。
 *   API-009  LoggerLevel 常量与数值比较:vendor cordis(4.1.0)必须
 *            ERROR=0/WARN=1/INFO=2/DEBUG=3(4.0.6 为 INFO=1/WARN=2);
 *            全仓日志级别数值比较逐条复核,未登记的命中即失败(allowlist 带
 *            失效检测,防「新代码悄悄写死旧序」)。
 *
 * 用法:
 *   node scripts/verify-rc5-env.mjs                 # ENV 四项
 *   node scripts/verify-rc5-env.mjs --api-static    # 追加 API-008/009 静态扫描
 *   node scripts/verify-rc5-env.mjs --runtime-image eterna-agent:rc5-test \
 *     --json <path>                                 # 追加 ENV-004/005 运行时断言
 *   node scripts/verify-rc5-env.mjs --runtime-container eterna-rc5-e1 \
 *     --compose-env-file $HOME/eterna-data/test-rc5/.env.e1   # 跑在现有容器上
 * 退出码:0 = 全部硬门禁通过;1 = 有硬门禁失败。WARN/informational 不影响退出码,
 *         但都会打印并进 JSON,供收尾清单消费。
 *
 * 只读:静态面不进容器、不联网、不读 .secrets/.env;运行时面只执行只读探针
 * (`dsh --version`/`node -v`/`readlink`/`test`/`fc-list`/`python3 import`),
 * `--runtime-image` 用 `docker run --rm --network none` 不挂载任何宿主目录;
 * 不带 --json 时不写任何文件,带 --json 时只写该报告路径。凭据零接触。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_VERSION = '0.2.2-rc.5'
const TARGET_CORDIS = '4.1.0'
const TARGET_COSMOKIT = '1.9.0'

/* ------------------------------------------------------------------ CLI */

const argv = process.argv.slice(2)
const apiStatic = argv.includes('--api-static')
const jsonAt = argv.indexOf('--json')
const jsonPath = jsonAt === -1 ? undefined : argv[jsonAt + 1]
if (jsonAt !== -1 && jsonPath === undefined) {
  console.error('--json 需要路径参数')
  process.exit(2)
}

function stringFlag(name) {
  const at = argv.indexOf(name)
  if (at === -1) return undefined
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} 需要参数`)
    process.exit(2)
  }
  return value
}

const runtimeImage = stringFlag('--runtime-image')
const runtimeContainer = stringFlag('--runtime-container')
const composeEnvFile = stringFlag('--compose-env-file')
const runtimeTarget = runtimeContainer !== undefined
  ? { kind: 'container', name: runtimeContainer }
  : runtimeImage !== undefined
    ? { kind: 'image', name: runtimeImage }
    : undefined

/* ------------------------------------------------------------- 文本工具 */

/** 版本残留 token:51 号 ENV-002 的三个 + 本仓另有历史钉版的 0.2.1/4.0.6。 */
const TOKENS = [
  { id: 'dsh-0.2.1', re: /(?<![0-9.])0\.2\.1(?![0-9])/g, gate: true },
  { id: 'dsh-alpha.2', re: /0\.2\.2-alpha\.2(?![0-9])/g, gate: true },
  { id: 'dsh-alpha.3', re: /0\.2\.2-alpha\.3(?![0-9])/g, gate: true },
  { id: 'dsh-rc.1', re: /0\.2\.2-rc\.1(?![0-9])/g, gate: true },
  { id: 'cordis-4.0.6', re: /(?<![0-9.])4\.0\.6(?![0-9])/g, gate: true },
  // 裸 `rc.1` 只作为 informational:历史叙述里大量出现(「rc.1 时代」),
  // 界定不清会淹没真命中;钉住形态 0.2.2-rc.1 已由上面覆盖。
  { id: 'bare-rc.1', re: /(?<![\w.-])rc\.1(?![0-9])/g, gate: false },
]

const HASH_COMMENT_EXT = new Set([
  '.yml', '.yaml', '.sh', '.py', '.toml', '.template', '.npmrc', '.gitignore', '.dockerignore', '.env',
])
const C_COMMENT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss'])

/** 去掉行内注释,保留代码部分(引号内的 # // 不算注释)。粗粒度但足够定位版本字面量。 */
function stripComment(line, file) {
  const ext = extname(file)
  if (ext === '.html') {
    const at = line.indexOf('<!--')
    return at === -1 ? line : line.slice(0, at)
  }
  const hashLike = HASH_COMMENT_EXT.has(ext) || /^Dockerfile/i.test(basename(file))
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote !== null) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (hashLike) {
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
    } else if (C_COMMENT_EXT.has(ext) || line.trimStart().startsWith('*')) {
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
      if (ch === '/' && line[i + 1] === '*') return line.slice(0, i)
      if (ch === '*' && i === line.search(/\*/) && line.trimStart().startsWith('*')) return line.slice(0, i)
    }
  }
  return line
}

// `.secrets/` 与 `.env*` 一律不进扫描面:脚本头部承诺「不读 .secrets/.env」,
// 这里必须在 walk 层强制,而不是只靠版本 token 的偶然不命中——证据 JSON 会
// 原样落盘命中行文本,凭据行一旦命中 token 就会被带进 artifacts。
const SKIP_DIRS = new Set(['node_modules', '.git', 'artifacts', 'coverage', '.eterna-home', '.zcode', '.secrets'])
const SKIP_DIR_PREFIX = ['.eterna-home-']
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json'])
const SKIP_FILE_RE = /^\.env($|\.)/
const TEXT_EXT = new Set([
  '.json', '.jsonc', '.yml', '.yaml', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.sh', '.py', '.toml', '.template', '.html', '.npmrc', '.gitignore', '.dockerignore', '.env', '.md',
])

/** 递归收集候选文本文件(绝对路径)。 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (SKIP_DIR_PREFIX.some(prefix => entry.name.startsWith(prefix))) continue
      walk(abs, out)
      continue
    }
    if (!entry.isFile()) continue
    if (SKIP_FILES.has(entry.name) || SKIP_FILE_RE.test(entry.name)) continue
    const ext = extname(entry.name)
    const isDockerfile = /^Dockerfile/i.test(entry.name) || entry.name === 'entrypoint.sh'
    if (!TEXT_EXT.has(ext) && !isDockerfile) continue
    out.push(abs)
  }
  return out
}

/** 51 号 ENV-002 明文排除「历史文档」:docs/、plans/ 与所有 *.md 只作为信息面,不参与门禁。 */
function isHistoricalDoc(rel) {
  return rel.startsWith('docs/') || rel.startsWith('plans/') || rel.endsWith('.md')
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1
  return line
}

/* ---------------------------------------------------------------- 报告面 */

const sections = []

function section(id, title, note) {
  const entry = { id, title, note, status: 'pass', assertions: [], hits: [], warnings: [], blockers: [] }
  sections.push(entry)
  return entry
}

function assert(entry, name, ok, detail) {
  entry.assertions.push({ name, ok, detail })
  if (!ok) {
    entry.status = 'fail'
    entry.blockers.push(`${name}: ${detail}`)
  }
  return ok
}

function hit(entry, hitEntry) {
  entry.hits.push(hitEntry)
}

function warn(entry, message) {
  entry.warnings.push(message)
  if (entry.status === 'pass') entry.status = 'warn'
}

/* ----------------------------------------------------- ENV-003 版本族 */

const DSK_SCOPE_RE = /^@deepseek-ai\/dsh(-|$)/
/**
 * 清单扫描面 = 全仓 package.json(本仓根 + packages/tools/packs/market/docker/profile/…),
 * 显式豁免 v1 与 core:core 是 vendor 内核(其依赖语义由 ENV-002 的版本残留面覆盖),
 * v1 是历史源码层——与任务口径「除 v1/core 外」一致。
 */
const MANIFEST_EXEMPT_PREFIXES = ['core/', 'v1/']

function readJson(abs) {
  return JSON.parse(readFileSync(abs, 'utf8'))
}

/** pnpm-workspace.yaml 的 catalog 段(轻量解析:只取 `  'name': version` 行)。 */
function readCatalog() {
  const file = join(repoRoot, 'pnpm-workspace.yaml')
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex(line => /^catalog:\s*$/.test(line))
  if (start === -1) return { file, entries: new Map() }
  const entries = new Map()
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\S/.test(line)) break
    const m = line.match(/^\s{2}'?(@?[^':\s]+)'?\s*:\s*(\S+)\s*(?:#.*)?$/)
    if (m !== null) entries.set(m[1], m[2])
  }
  return { file, entries }
}

function collectScopedManifests() {
  const files = []
  for (const abs of walk(repoRoot)) {
    if (basename(abs) !== 'package.json') continue
    const rel = relative(repoRoot, abs)
    if (MANIFEST_EXEMPT_PREFIXES.some(prefix => rel.startsWith(prefix))) continue
    files.push(abs)
  }
  return files.sort()
}

/** 依赖 spec 的残留分类:pin(硬门禁)/ floor(旧下限,WARN)/ ok。 */
function classifySpec(spec) {
  const exact = /^(?:=|~|\^)?\s*(?:\d+\.\d+\.\d+[-\w.]*)$/.test(spec)
  const staleExact = /^(?:=|~|\^)?\s*(0\.2\.1|0\.2\.2-(?:alpha\.[23]|rc\.1)|4\.0\.6)(?![\d])/.test(spec)
  const staleFloor = /^>=?\s*(0\.2\.1|0\.2\.2-(?:alpha\.[23]|rc\.1)|4\.0\.6)(?![\d])/.test(spec)
  if (staleExact) return 'pin'
  if (staleFloor) return 'floor'
  return exact ? 'exact' : 'other'
}

function checkEnv003() {
  const entry = section('ENV-003', '版本族统一(全仓 package.json 免 v1/core + workspace catalog)',
    '51 ENV-003:全部 0.2.2-rc.5;cordis 4.1.0;cosmokit 1.9.0。硬门禁=0.2.1/rc.1/4.0.6 的钉版。')

  const catalog = readCatalog()
  const dshEntries = [...catalog.entries].filter(([name]) => DSK_SCOPE_RE.test(name))
  const badCatalog = dshEntries.filter(([, version]) => version !== TARGET_VERSION)
  assert(entry, 'catalog dsh 全族 = 0.2.2-rc.5',
    badCatalog.length === 0,
    `${dshEntries.length} 个 @deepseek-ai/dsh-* catalog 条目,期望 ${TARGET_VERSION};偏离:${
      badCatalog.map(([name, version]) => `${name}=${version}`).join(', ') || '无'}`)
  assert(entry, 'catalog @deepseek-ai/cordis = 4.1.0',
    catalog.entries.get('@deepseek-ai/cordis') === TARGET_CORDIS,
    `实测 ${catalog.entries.get('@deepseek-ai/cordis') ?? '(缺)'}`)
  assert(entry, 'catalog @deepseek-ai/cosmokit = 1.9.0',
    catalog.entries.get('@deepseek-ai/cosmokit') === TARGET_COSMOKIT,
    `实测 ${catalog.entries.get('@deepseek-ai/cosmokit') ?? '(缺)'}`)

  const manifests = collectScopedManifests()
  const pins = []
  const floors = []
  const exactMismatch = []
  let dshSpecCount = 0
  for (const abs of manifests) {
    let pkg
    try { pkg = readJson(abs) } catch (error) {
      hit(entry, { path: relative(repoRoot, abs), line: 0, value: '', token: 'unreadable', kind: 'error', text: String(error.message) })
      continue
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const block = pkg[field]
      if (block === undefined || block === null) continue
      for (const [name, spec] of Object.entries(block)) {
        if (!DSK_SCOPE_RE.test(name) && name !== '@deepseek-ai/cordis' && name !== '@deepseek-ai/cosmokit') continue
        if (typeof spec !== 'string') continue
        const rel = relative(repoRoot, abs)
        const kind = classifySpec(spec)
        if (DSK_SCOPE_RE.test(name)) dshSpecCount += 1
        if (kind === 'pin') {
          pins.push(`${rel} ${field}.${name}=${spec}`)
          hit(entry, { path: rel, line: findLine(rel, `"${name}": "${spec}"`), value: spec, token: 'stale-pin', kind, text: `${name} = ${spec}` })
        } else if (kind === 'floor') {
          floors.push(`${rel} ${field}.${name}=${spec}`)
          hit(entry, { path: rel, line: findLine(rel, `"${name}": "${spec}"`), value: spec, token: 'stale-floor', kind, text: `${name} = ${spec}` })
        } else if (kind === 'exact' && DSK_SCOPE_RE.test(name) && spec !== TARGET_VERSION) {
          exactMismatch.push(`${rel} ${field}.${name}=${spec}`)
          hit(entry, { path: rel, line: findLine(rel, `"${name}": "${spec}"`), value: spec, token: 'dsh-version-mismatch', kind: 'pin', text: `${name} = ${spec}` })
        }
      }
    }
  }

  assert(entry, '清单中无 0.2.1/rc.1/4.0.6 钉版',
    pins.length === 0,
    pins.length === 0 ? `扫描 ${manifests.length} 个清单 / ${dshSpecCount} 条 @deepseek-ai/dsh* spec` : pins.join('; '))
  assert(entry, '清单 dsh* 精确版无偏离 rc.5',
    exactMismatch.length === 0,
    exactMismatch.length === 0 ? '全部 catalog:/workspace:/精确 rc.5' : exactMismatch.join('; '))

  if (floors.length > 0) {
    warn(entry, `${floors.length} 条旧下限(>=0.2.1/rc.1/4.0.6,仍允许 rc.5 解析)未收敛:${floors.join('; ')}`)
  }
  entry.scanned = { manifests: manifests.length, dshSpecs: dshSpecCount, catalogDsh: dshEntries.length }
  entry.scannedFiles = manifests.length + 1 // 清单 + pnpm-workspace.yaml
  entry.files = [...manifests.map(abs => relative(repoRoot, abs)), relative(repoRoot, catalog.file)]
  return entry
}

const lineCache = new Map()
function findLine(rel, needle) {
  const cacheKey = rel
  let text = lineCache.get(cacheKey)
  if (text === undefined) {
    try { text = readFileSync(join(repoRoot, rel), 'utf8') } catch { text = '' }
    lineCache.set(cacheKey, text)
  }
  const at = text.indexOf(needle)
  if (at === -1) return 0
  return lineOf(text, at)
}

/* -------------------------------------------------- ENV-002 版本残留扫描 */

function checkEnv002() {
  const entry = section('ENV-002', '全仓版本残留(排除历史文档/锁文件)',
    '51 ENV-002:0.2.2-alpha.2|alpha.3|rc.1 命中 0;本仓另扫 0.2.1/4.0.6。非注释命中为硬门禁,注释命中为信息面。')
  const files = walk(repoRoot)
  // 凭据面硬断言:证据 JSON 会落盘命中行原文,扫描面绝不能含 .secrets/ 或 .env*。
  const secretLike = files.filter(abs => {
    const rel = relative(repoRoot, abs)
    return rel.startsWith('.secrets/') || /(^|\/)\.env($|\.)/.test(rel)
  })
  assert(entry, '扫描面不含 .secrets/.env*',
    secretLike.length === 0,
    secretLike.length === 0 ? '凭据面 0 文件' : secretLike.map(abs => relative(repoRoot, abs)).join(', '))
  const gated = []
  const commentOnly = []
  const docs = []
  const prose = []
  const weak = []
  let scanned = 0
  let selfSkipped = false

  for (const abs of files) {
    const rel = relative(repoRoot, abs)
    // 扫描器自身:正则与断言文案里必然含 token 字面量,自检等价于恒红。
    // 它的正确性由 tests 式自证(见报告 assertions)+ 人工复核,不进被扫面。
    if (rel === 'scripts/verify-rc5-env.mjs') { selfSkipped = true; continue }
    const historical = isHistoricalDoc(rel)
    let text
    try { text = readFileSync(abs, 'utf8') } catch { continue }
    if (text.length > 1_500_000) continue
    scanned += 1
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const live = stripComment(line, abs)
      for (const token of TOKENS) {
        token.re.lastIndex = 0
        if (!token.re.test(line)) continue
        const inLive = (() => {
          const re = new RegExp(token.re.source, token.re.flags.replace('g', ''))
          return re.test(live)
        })()
        // 清单 description 是散文叙述(不是依赖 spec),按历史叙述处理:
        // 列全部命中但不阻断——依赖钉版由 ENV-003 结构化核对,不靠文本扫描。
        const isManifestProse = extname(rel) === '.json' && /^\s*"description"\s*:/.test(line)
        const rec = {
          path: rel,
          line: i + 1,
          token: token.id,
          kind: isManifestProse ? 'prose' : historical ? 'doc' : inLive ? 'live' : 'comment',
          gated: token.gate && !historical && inLive && !isManifestProse,
          text: line.trim().slice(0, 200),
        }
        if (rec.kind === 'doc') docs.push(rec)
        else if (rec.kind === 'prose') prose.push(rec)
        else if (rec.kind === 'comment') commentOnly.push(rec)
        else if (!token.gate) weak.push(rec) // 裸 rc.1:界定不清,只留痕不门禁
        else gated.push(rec)
      }
    }
  }

  assert(entry, '代码/配置无非注释残留',
    gated.length === 0,
    gated.length === 0
      ? `扫描 ${scanned} 个文件,非注释命中 0`
      : `${gated.length} 处(清单见下/JSON)`)

  entry.scannedFiles = scanned
  entry.selfScanned = !selfSkipped
  entry.gatedCount = gated.length
  entry.commentCount = commentOnly.length
  entry.docCount = docs.length
  entry.proseCount = prose.length
  entry.weakCount = weak.length
  for (const rec of gated) hit(entry, rec)
  // 非门禁面命中量大,JSON 每类只留前 400 条并注明截断,控制台打印按目录聚合的计数。
  const cap = list => ({ items: list.slice(0, 400), total: list.length, truncated: list.length > 400 })
  entry.informational = {
    comments: cap(commentOnly),
    docs: cap(docs),
    manifestProse: cap(prose),
    weakBareTokens: cap(weak),
  }
  if (commentOnly.length + docs.length + prose.length + weak.length > 0) {
    const byDir = new Map()
    for (const rec of [...commentOnly, ...docs, ...prose, ...weak]) {
      const dir = rec.path.includes('/') ? rec.path.slice(0, rec.path.indexOf('/')) : rec.path
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
    }
    entry.warnings.push(`历史叙述命中 ${commentOnly.length} 注释 + ${docs.length} 文档 + ${prose.length} 清单 description + ${weak.length} 裸 rc.1(不计门禁):${
      [...byDir].map(([dir, count]) => `${dir}=${count}`).join(', ')}`)
  }
  return entry
}

/* ------------------------------------------------------- ENV-006 Dockerfile */

function checkEnv006() {
  const entry = section('ENV-006', 'Dockerfile 内核钉版',
    '51 ENV-006:grep @deepseek-ai/dsh@ → 精确 rc.5,无 alpha.3;49 §4:只装 dsh,mcp-client 用宿主内嵌。')
  const rel = 'Dockerfile'
  const text = readFileSync(join(repoRoot, rel), 'utf8')
  const effective = text.split('\n').map(line => stripComment(line, rel)).join('\n')
  const installs = [...effective.matchAll(/@deepseek-ai\/dsh(-mcp-client)?@([^\s\\,;]+)/g)]
    .map(match => ({ pkg: match[1] === undefined ? 'dsh' : 'dsh-mcp-client', version: match[2] }))

  const dsh = installs.filter(item => item.pkg === 'dsh')
  const mcp = installs.filter(item => item.pkg === 'dsh-mcp-client')
  assert(entry, '全局内核精确 0.2.2-rc.5',
    dsh.length === 1 && dsh[0].version === TARGET_VERSION,
    dsh.length === 0 ? '未找到 @deepseek-ai/dsh@ 安装行' : dsh.map(item => `${item.pkg}@${item.version}`).join(', '))
  assert(entry, '有效行无 alpha.* 钉版',
    !/0\.2\.2-alpha\.\d/.test(effective),
    (effective.match(/0\.2\.2-alpha\.\d+/g) ?? ['无']).join(', '))

  if (mcp.length > 0) {
    warn(entry, `全局另装 ${mcp.map(item => `${item.pkg}@${item.version}`).join(', ')};49 §4 目标为「只装 dsh,mcp-client 用宿主内嵌」`)
  }
  for (const item of installs) {
    hit(entry, {
      path: rel,
      line: findLineInText(text, `@deepseek-ai/${item.pkg}@${item.version}`),
      value: item.version,
      token: `npm-i-g-${item.pkg}`,
      kind: item.version === TARGET_VERSION ? 'ok' : 'stale-pin',
      text: `npm i -g @deepseek-ai/${item.pkg}@${item.version}`,
    })
  }
  entry.scannedFiles = 1
  entry.files = [rel]
  return entry
}

function findLineInText(text, needle) {
  const at = text.indexOf(needle)
  return at === -1 ? 0 : lineOf(text, at)
}

/* -------------------------------------------------- ENV-004 静态代理 */

function checkEnv004() {
  const entry = section('ENV-004', '容器内 dsh --version = 0.2.2-rc.5(静态代理)',
    '51 ENV-004 的运行时半需 P5 镜像;此处只验「本仓实装版本 + 镜像钉版」两处静态事实。')
  entry.scope = 'static-only'
  entry.runtime = 'not-run'
  let installed = '(未安装)'
  try {
    installed = readJson(join(repoRoot, 'node_modules/@deepseek-ai/dsh/package.json')).version
  } catch { /* 记录为未安装 */ }
  assert(entry, 'workspace 实装 @deepseek-ai/dsh = rc.5',
    installed === TARGET_VERSION,
    `实测 ${installed}`)

  const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8')
  const effective = dockerfile.split('\n').map(line => stripComment(line, 'Dockerfile')).join('\n')
  const pins = [...effective.matchAll(/@deepseek-ai\/dsh@([^\s\\,;]+)/g)].map(match => match[1])
  assert(entry, '镜像钉版 = rc.5(静态)',
    pins.length === 1 && pins[0] === TARGET_VERSION,
    pins.length === 0 ? '无安装行' : pins.join(', '))
  entry.note = runtimeTarget === undefined
    ? `${entry.note} 运行时检查(容器内 dsh --version)未执行:加 --runtime-image/--runtime-container。`
    : `${entry.note} 运行时检查见 RC5-ENV-004(目标 ${runtimeTarget.kind}:${runtimeTarget.name})。`
  entry.scannedFiles = 2
  entry.files = ['Dockerfile', 'node_modules/@deepseek-ai/dsh/package.json']
  return entry
}

/* ----------------------------------------------- API-008 LlmError 签名 */

/** 从 `open` 位置的 '(' 起做括号配对(跳过字符串/模板/注释),返回闭括号下标。 */
function matchParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === '\\') { i += 1; continue }
        if (text[i] === quote) break
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue }
    if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i === -1) return -1; i += 1; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 顶层逗号切分(忽略嵌套括号/字符串)。 */
function splitArgs(text) {
  const args = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === '\\') { i += 1; continue }
        if (text[i] === quote) break
      }
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    else if (ch === ',' && depth === 0) { args.push(text.slice(start, i).trim()); start = i + 1 }
  }
  const tail = text.slice(start).trim()
  // 尾随逗号 `f(a, b,)` 不产生空参数。
  if (tail !== '') args.push(tail)
  return args
}

const LLM_ERROR_CODES = new Set([
  'ABORTED', 'ACCOUNT_QUOTA', 'ACCOUNT_SIGN_IN_REQUIRED', 'ACCOUNT_TOKEN_INVALID', 'AUTH',
  'CLIENT_UPGRADE_REQUIRED', 'CONTENT_REFUSED', 'CONTEXT_WINDOW_EXCEEDED', 'DISCOVERY_FAILED',
  'DISCOVERY_UNSUPPORTED', 'DUPLICATE_ADAPTER', 'DUPLICATE_DIRECTORY', 'DUPLICATE_DISCOVERY',
  'EMPTY_RESPONSE', 'FILES_API', 'IMAGE_OFFLOAD_REQUIRED', 'INVALID_ADAPTER', 'INVALID_CATALOG',
  'INVALID_CONFIG', 'INVALID_CREDENTIAL', 'INVALID_DIRECTORY', 'INVALID_DISCOVERY',
  'INVALID_MODEL_CONTEXT', 'INVALID_MODEL_INFO', 'INVALID_MODEL_MAX_TOKENS',
  'INVALID_MODEL_REASONING', 'INVALID_PREPARED_CALL', 'INVALID_REPLAY_STATE', 'INVALID_REQUEST',
  'INVALID_RESPONSE', 'MALFORMED_RESPONSE', 'MISSING_CREDENTIAL', 'MODEL_SWITCH_COMPACTION_FAILED',
  'MODEL_UNSUPPORTED', 'NO_ADAPTER', 'NO_CREDENTIAL_STORE', 'NO_DISCOVERY', 'PI_AI_ERROR',
  'QUOTA', 'RATE_LIMIT', 'REGISTRATION_DISPOSED', 'REQUEST_EXTENSION', 'REQUEST_HEADERS', 'SERVER',
  'STREAM_CLOSED', 'TIMEOUT', 'TRANSPORT', 'UNKNOWN', 'UNKNOWN_MODEL', 'UNSTORABLE_PROVIDER_ID',
  'UNSUPPORTED_CONTENT', 'UNSUPPORTED_OPTION', 'UNSUPPORTED_REASONING_EFFORT',
])

function isConstantCode(expr) {
  // HTTP_<status> 模板形态:上游 union 是 `HTTP_${number}`,插值必须是数值表达式;
  // `String(x)`/`x.toString()` 会退化成 `HTTP_${string}`,tsc 直接拒绝(实测 TS2345)。
  const httpTemplate = expr.match(/^`HTTP_\$\{(.+)\}`$/)
  if (httpTemplate !== null) return !/String\s*\(|\.toString\s*\(/.test(httpTemplate[1])
  if (/^'(ABORTED|ACCOUNT_QUOTA|ACCOUNT_SIGN_IN_REQUIRED|ACCOUNT_TOKEN_INVALID|AUTH|CLIENT_UPGRADE_REQUIRED|CONTENT_REFUSED|CONTEXT_WINDOW_EXCEEDED|DISCOVERY_FAILED|DISCOVERY_UNSUPPORTED|DUPLICATE_ADAPTER|DUPLICATE_DIRECTORY|DUPLICATE_DISCOVERY|EMPTY_RESPONSE|FILES_API|IMAGE_OFFLOAD_REQUIRED|INVALID_ADAPTER|INVALID_CATALOG|INVALID_CONFIG|INVALID_CREDENTIAL|INVALID_DIRECTORY|INVALID_DISCOVERY|INVALID_MODEL_CONTEXT|INVALID_MODEL_INFO|INVALID_MODEL_MAX_TOKENS|INVALID_MODEL_REASONING|INVALID_PREPARED_CALL|INVALID_REPLAY_STATE|INVALID_REQUEST|INVALID_RESPONSE|MALFORMED_RESPONSE|MISSING_CREDENTIAL|MODEL_SWITCH_COMPACTION_FAILED|MODEL_UNSUPPORTED|NO_ADAPTER|NO_CREDENTIAL_STORE|NO_DISCOVERY|PI_AI_ERROR|QUOTA|RATE_LIMIT|REGISTRATION_DISPOSED|REQUEST_EXTENSION|REQUEST_HEADERS|SERVER|STREAM_CLOSED|TIMEOUT|TRANSPORT|UNKNOWN|UNKNOWN_MODEL|UNSTORABLE_PROVIDER_ID|UNSUPPORTED_CONTENT|UNSUPPORTED_OPTION|UNSUPPORTED_REASONING_EFFORT)'$/.test(expr)) return true
  if (/^(?:[A-Za-z_$][\w$]*\.)*[A-Z][A-Z0-9_]*$/.test(expr)) return true // 具名常量(如 CONTEXT_WINDOW_EXCEEDED_CODE)
  return false
}

/**
 * 文件内声明为 `: BuiltinLlmFailureCode` 的辅助函数名。第二参写成 `httpCode(...)`
 * 时静态面无法内联求值,但若该函数在**同文件**显式标注返回 BuiltinLlmFailureCode,
 * 它的结果就是合法码(rc.5 上游推荐把 HTTP_${status} 分支收进类型化 helper)。
 * 只认同文件声明,不认跨文件导入(维持「可静态复核」的边界)。
 */
function typedCodeHelpers(text) {
  const names = new Set()
  for (const match of text.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*:\s*BuiltinLlmFailureCode\b/g)) names.add(match[1])
  for (const match of text.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*:\s*BuiltinLlmFailureCode\b/g)) names.add(match[1])
  return names
}

function isTypedCodeCall(expr, helpers) {
  const call = expr.match(/^([A-Za-z_$][\w$]*)\s*\(/)
  return call !== null && helpers.has(call[1])
}

function checkApi008() {
  const entry = section('API-008', 'LlmError 构造签名(rc.5: message, code, options?)',
    '51 API-008:无旧构造签名残留。静态扫描 new LlmError(...) 参数形态 + 记录 fromFailure 出点。')
  const files = walk(repoRoot).filter(abs => {
    const rel = relative(repoRoot, abs)
    if (!/\.(ts|tsx|mjs|js|cjs)$/.test(rel)) return false
    if (rel === 'scripts/verify-rc5-env.mjs') return false // 扫描器自述文本不参与扫描
    if (rel.startsWith('packages/') || rel.startsWith('tools/') || rel.startsWith('core/') || rel.startsWith('scripts/')) {
      if (rel.includes('/lib/') || rel.includes('/dist/') || rel.endsWith('.d.ts')) return false
      if (/\.(test|spec)\.(ts|js|mjs)$/.test(rel)) return false // 测试里的假错误类不计入构造点
      return true
    }
    return false
  })

  const constructions = []
  const fromFailures = []
  const violations = []
  const violationHits = []
  for (const abs of files) {
    const rel = relative(repoRoot, abs)
    const text = readFileSync(abs, 'utf8')
    const lines = text.split('\n')
    const helpers = typedCodeHelpers(text)
    for (const match of text.matchAll(/new\s+LlmError\s*\(/g)) {
      // 文档/注释里的 `new LlmError(...)` 叙述不是构造点(用去注释后的行判定)。
      if (!stripComment(lines[lineOf(text, match.index) - 1] ?? '', abs).includes('new LlmError(')) continue
      const open = match.index + match[0].length - 1
      const close = matchParen(text, open)
      if (close === -1) {
        violations.push(`${rel}:${lineOf(text, match.index)} 括号不配对`)
        violationHits.push({ path: rel, line: lineOf(text, match.index), token: 'unbalanced-call', kind: 'stale-signature', text: '括号不配对' })
        continue
      }
      const args = splitArgs(text.slice(open + 1, close))
      const line = lineOf(text, match.index)
      const rec = { path: rel, line, argCount: args.length, second: args[1] ?? '', text: args.map(a => a.slice(0, 60)).join(' | ') }
      constructions.push(rec)
      if (args.length < 2) {
        violations.push(`${rel}:${line} 单参构造(旧签名?):${rec.text}`)
        violationHits.push({ path: rel, line, token: 'single-arg-constructor', kind: 'stale-signature', text: rec.text })
      } else if (args.length > 3) {
        violations.push(`${rel}:${line} 参数过多(${args.length}):${rec.text}`)
        violationHits.push({ path: rel, line, token: 'too-many-args', kind: 'stale-signature', text: rec.text })
      } else if (!isConstantCode(args[1]) && !isTypedCodeCall(args[1], helpers)) {
        violations.push(`${rel}:${line} 第二参不是 BuiltinLlmFailureCode 常量:${args[1].slice(0, 80)}`)
        violationHits.push({ path: rel, line, token: 'invalid-failure-code', kind: 'stale-signature', text: args[1].slice(0, 120) })
      }
    }
    for (const match of text.matchAll(/LlmError\.fromFailure\s*\(/g)) {
      const open = match.index + match[0].length - 1
      const close = matchParen(text, open)
      const args = close === -1 ? [] : splitArgs(text.slice(open + 1, close))
      fromFailures.push({ path: rel, line: lineOf(text, match.index), argCount: args.length })
      if (args.length < 1 || args.length > 2) violations.push(`${rel}:${lineOf(text, match.index)} fromFailure 参数数 ${args.length}(期望 1..2)`)
    }
  }

  assert(entry, '无旧构造签名残留', violations.length === 0, violations.length === 0
    ? `${constructions.length} 处构造全部 (message, code[, options]);${fromFailures.length} 处 fromFailure 形态合法`
    : violations.join('; '))
  assert(entry, '构造点非空(扫描面有效)', constructions.length > 0, `命中 ${constructions.length} 处`)
  // 同一构造点只留一条命中:有违例的标 stale-signature,合规的标 ok。
  const violationKeys = new Set(violationHits.map(rec => `${rec.path}:${rec.line}`))
  for (const rec of constructions) {
    const bad = violationKeys.has(`${rec.path}:${rec.line}`)
    hit(entry, { ...rec, token: bad ? 'invalid-llm-error-arg' : 'new-LlmError', kind: bad ? 'stale-signature' : 'ok' })
  }
  for (const rec of violationHits) {
    if (!constructions.some(item => item.path === rec.path && item.line === rec.line)) hit(entry, rec)
  }
  entry.scannedFiles = files.length
  entry.fromFailureSites = fromFailures.map(rec => `${rec.path}:${rec.line}`)
  return entry
}

/* --------------------------------------------------- API-009 LoggerLevel */

/**
 * 全仓日志级别数值比较的登记簿。每条必须能在扫描中复现(失效即失败),
 * 未登记的新命中同样失败——逼代码作者显式论证「这条数值比较为什么不随
 * 4.0.6→4.1.0 的数值反转而错档」。
 */
const LEVEL_COMPARISON_ALLOWLIST = [
  {
    path: 'core/cordis/src/logger.ts',
    pattern: 'level >= 2 ? c256 : c16',
    reason: 'vendor 自 cordis 4.1.0 的 Logger.code:按级别深度选 ANSI 调色板(c256/c16),纯配色不影响阈值判定;与实装 @deepseek-ai/cordis@4.1.0 lib/index.js:1007 逐字相同',
  },
  {
    path: 'packages/tasks/src/store/store.ts',
    pattern: 'level > 0 ? this.committed[level - 1]',
    reason: 'SQLite SAVEPOINT 嵌套深度(同文件 level = this.depth++),与日志严重级无关;非 LoggerLevel 消费方',
  },
]

const LEVEL_NUMERIC_COMPARISON_PATTERNS = [
  // level/Level 标识符与数值字面量的比较(任一侧)
  /(?:\b|\()([A-Za-z_$][\w$]*)?[Ll]evel\b\s*(?:<=|>=|<|>|===|!==|==|!=)\s*\d/,
  /\b\d\s*(?:<=|>=|<|>|===|!==|==|!=)\s*(?:[A-Za-z_$][\w$.]*\.)?[Ll]evel\b/,
  // 以 0..3 字面量作级别阈值/映射(值必须紧跟数字/花括号,排除 `level: Number(x[1])` 这类同名误报)
  /\b(?:levels?|minLevel|maxLevel)\s*[:=]\s*\{?\s*[0-3]\b/,
  // 级别名索引表(顺序敏感):含 error 与 warn/info 的数组字面量
  /\[\s*['"](?:error|ERROR)['"]\s*,\s*['"](?:warn|WARN|info|INFO)['"]/,
  /\[\s*['"](?:info|INFO)['"]\s*,\s*['"](?:warn|WARN)['"]/,
]

function readLoggerLevelLiteral(fileRel) {
  const text = readFileSync(join(repoRoot, fileRel), 'utf8')
  // 源码形态 `export const LoggerLevel = { ... }`;d.ts 形态
  // `export declare const LoggerLevel: { readonly WARN: 1; ... }`。
  const block = text.match(/LoggerLevel\s*[:=]\s*\{([\s\S]*?)\}/)
  if (block === null) return null
  const values = {}
  for (const match of block[1].matchAll(/([A-Z]+)\s*:\s*(\d+)/g)) values[match[1]] = Number(match[2])
  return { path: fileRel, values }
}

function checkApi009() {
  const entry = section('API-009', 'LoggerLevel 数值语义(4.1.0: WARN=1 / INFO=2)',
    '51 API-009:级别显示正确(rc.5 数值语义)。静态半=常量值与全仓数值比较复核;真行为(E2E 触发 debug/info/warn)属 T49e。')

  const src = readLoggerLevelLiteral('core/cordis/src/logger.ts')
  const expected = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }
  const srcOk = src !== null && Object.entries(expected).every(([name, value]) => src.values[name] === value)
  assert(entry, 'vendor LoggerLevel = {ERROR:0, WARN:1, INFO:2, DEBUG:3}', srcOk,
    src === null ? '未在 core/cordis/src/logger.ts 找到 LoggerLevel 字面量' : JSON.stringify(src.values))

  // 已构建产物若存在,必须同值(否则 dist 消费方会读旧序)。
  let builtOk = true
  let builtDetail = 'core/cordis/lib/types/logger.d.ts 不存在(未构建),跳过'
  try {
    const built = readLoggerLevelLiteral('core/cordis/lib/types/logger.d.ts')
    builtOk = built !== null && Object.entries(expected).every(([name, value]) => built.values[name] === value)
    builtDetail = built === null ? '未找到 LoggerLevel 声明' : JSON.stringify(built.values)
  } catch { /* 文件不存在:跳过 */ }
  assert(entry, '构建产物 LoggerLevel 同值', builtOk, builtDetail)

  // 阈值比较必须用符号,且方向与上游一致(targetLevel < level ⇒ targetLevel 为最大verbose档)。
  const loggerSrc = readFileSync(join(repoRoot, 'core/cordis/src/logger.ts'), 'utf8')
  const usesSymbol = /exporter\.levels\?\.\[this\.name\]\s*\?\?\s*exporter\.levels\?\.default\s*\?\?\s*this\.level\s*\?\?\s*LoggerLevel\.INFO/.test(loggerSrc)
  const filterDirection = /targetLevel\s*<\s*level\s*\)\s*continue/.test(loggerSrc)
  assert(entry, '阈值缺省用 LoggerLevel.INFO 符号(非字面量 2)', usesSymbol, usesSymbol ? 'logger.ts:159 形态匹配' : '未匹配到符号形态')
  assert(entry, '过滤方向 targetLevel < level(与上游 4.1.0 一致)', filterDirection, filterDirection ? 'logger.ts:160 形态匹配' : '未匹配到过滤形态')

  // 上游对照(实装 4.1.0 包):同一表达式的字节级证据,供日志消费方复核。
  const files = walk(repoRoot).filter(abs => {
    const rel = relative(repoRoot, abs)
    if (!/\.(ts|tsx|mjs|js|cjs)$/.test(rel)) return false
    if (rel === 'scripts/verify-rc5-env.mjs') return false // 扫描器自身(正则/断言文案含模式字面量)
    if (rel.startsWith('docs/') || rel.startsWith('plans/')) return false
    if (rel.includes('/node_modules/') || rel.includes('/lib/') || rel.includes('/dist/')) return false
    return true
  })
  const found = []
  for (const abs of files) {
    const rel = relative(repoRoot, abs)
    const lines = readFileSync(abs, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const live = stripComment(lines[i], abs)
      if (!/[Ll]evel/.test(live)) continue
      if (!LEVEL_NUMERIC_COMPARISON_PATTERNS.some(re => re.test(live))) continue
      found.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) })
    }
  }

  const registered = []
  const unregistered = []
  const usedAllow = new Set()
  for (const rec of found) {
    const rule = LEVEL_COMPARISON_ALLOWLIST.find(item => item.path === rec.path && rec.text.includes(item.pattern))
    if (rule === undefined) unregistered.push(rec)
    else { usedAllow.add(rule); registered.push({ ...rec, reason: rule.reason }) }
  }
  const rotten = LEVEL_COMPARISON_ALLOWLIST.filter(rule => !usedAllow.has(rule))

  assert(entry, '全仓日志级别数值比较均在登记簿内', unregistered.length === 0,
    unregistered.length === 0
      ? `${found.length} 处命中,全部复核登记`
      : unregistered.map(rec => `${rec.path}:${rec.line} ${rec.text}`).join('; '))
  assert(entry, '登记簿无失效条目', rotten.length === 0,
    rotten.length === 0 ? '无' : rotten.map(rule => rule.path).join(', '))
  for (const rec of registered) hit(entry, { ...rec, token: 'level-numeric-compare', kind: 'ok', reason: rec.reason })
  entry.scannedFiles = files.length
  entry.allowlist = LEVEL_COMPARISON_ALLOWLIST.map(rule => ({ path: rule.path, pattern: rule.pattern, reason: rule.reason }))
  return entry
}

/* ------------------------------------------------------- 规则自检 */

/**
 * 规则自检:判定函数是门禁的全部信任基础,「扫到 0 条」只有在规则本身可证
 * 有效时才有意义。这里用固定样例锁死正向/负向判定,防「规则写错 ⇒ 恒绿」。
 */
function checkSelfTest() {
  const entry = section('SELF', '扫描规则自检', '正向/负向样例锁死 classifySpec / stripComment / splitArgs / isConstantCode。')
  const cases = [
    ['classifySpec 精确旧版 = pin', () => classifySpec('0.2.2-rc.1') === 'pin'],
    ['classifySpec 波浪旧版 = pin', () => classifySpec('~4.0.6') === 'pin'],
    ['classifySpec 脱字符 alpha.2 = pin', () => classifySpec('^0.2.2-alpha.2') === 'pin'],
    ['classifySpec 旧下限 = floor', () => classifySpec('>=4.0.6-alpha.1') === 'floor'],
    ['classifySpec 目标版 = exact', () => classifySpec(TARGET_VERSION) === 'exact'],
    ['classifySpec catalog: = other', () => classifySpec('catalog:') === 'other'],
    ['stripComment 注释行归零', () => stripComment('# npm i -g @deepseek-ai/dsh@0.2.2-alpha.3', 'Dockerfile').trim() === ''],
    ['stripComment 有效行保留', () => stripComment('RUN npm i -g @deepseek-ai/dsh@0.2.2-alpha.3', 'Dockerfile').includes('alpha.3')],
    ['stripComment 行尾注释剥离', () => !stripComment("pin: '0.2.2-rc.5' # 历史 rc.1", 'x.yml').includes('rc.1')],
    ['stripComment 引号内 # 不算注释', () => stripComment("'a#b'", 'x.yml').includes('a#b')],
    ['splitArgs 尾随逗号不产空参', () => splitArgs("'a', 'b',").length === 2],
    ['splitArgs 嵌套对象', () => splitArgs("'m', 'CODE', { cause: (e) => e }").length === 3],
    ['isConstantCode 内置码', () => isConstantCode("'MISSING_CREDENTIAL'") === true],
    ['isConstantCode HTTP 数值模板', () => isConstantCode('`HTTP_${response.status}`') === true],
    ['isConstantCode 拒绝 String() 插值(退化为 HTTP_${string})', () => isConstantCode('`HTTP_${String(s)}`') === false],
    ['isConstantCode 拒绝旧对象形态', () => isConstantCode('{ code: 1 }') === false],
    ['isTypedCodeCall 认同文件 typed helper', () => isTypedCodeCall('httpCode(status, fields)', typedCodeHelpers('function httpCode(status: number, fields: X): BuiltinLlmFailureCode { return `HTTP_${status}` }'))],
    ['isTypedCodeCall 认箭头形态', () => isTypedCodeCall('code(7)', typedCodeHelpers('const code = (n: number): BuiltinLlmFailureCode => `HTTP_${n}`'))],
    ['isTypedCodeCall 拒无返回标注 helper', () => isTypedCodeCall('other(1)', typedCodeHelpers('function other(x: number): string { return "" }')) === false],
  ]
  const failed = cases.filter(([, run]) => {
    try { return run() !== true } catch { return true }
  }).map(([name]) => name)
  assert(entry, '规则样例全部通过', failed.length === 0,
    failed.length === 0 ? `${cases.length}/${cases.length} 条样例通过` : `失败:${failed.join(', ')}`)
  return entry
}

/* ------------------------------------- ENV-004/005 运行时（镜像/容器断言） */

const BASIS_PACKAGES = ['system-prompt', 'session', 'tools', 'llm', 'approval-cli', 'agent-loop']

/** 在镜像(docker run --rm --network none)或现有容器(docker exec)里跑只读 shell 探针。 */
function runtimeExec(script, timeout = 60_000) {
  const options = { encoding: 'utf8', timeout }
  const result = runtimeTarget.kind === 'container'
    ? spawnSync('docker', ['exec', runtimeTarget.name, 'sh', '-c', script], options)
    : spawnSync('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'sh', runtimeTarget.name, '-c', script], options)
  return {
    code: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  }
}

function parseSemver(text) {
  const match = String(text).match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function semverAtLeast(actual, minimum) {
  const a = parseSemver(actual)
  const b = parseSemver(minimum)
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

function probeFailure(result) {
  return `exit=${result.code}${result.stderr === '' ? '' : ` err=${result.stderr.split('\n')[0].slice(0, 160)}`}`
}

function checkRuntimeEnv() {
  const entry = section('RC5-ENV-004', '镜像运行时：dsh 版本 / symlink realpath / mcp-client 同版 / node / v1 剥离',
    `目标=${runtimeTarget.kind}:${runtimeTarget.name}（只读探针）`)
  entry.runtime = runtimeTarget.kind

  /* ENV-004 dsh --version */
  const version = runtimeExec('dsh --version')
  assert(entry, 'dsh --version = 0.2.2-rc.5',
    version.code === 0 && version.stdout === TARGET_VERSION,
    version.code === 0 ? `输出 ${version.stdout === '' ? '<empty>' : version.stdout}` : probeFailure(version))

  /* symlink realpath + 包版本（T37/T48） */
  const real = runtimeExec('readlink -f "$(command -v dsh)"')
  const realpath = real.stdout
  assert(entry, 'symlink realpath 解析到 @deepseek-ai/dsh',
    real.code === 0 && /\/@deepseek-ai\/dsh\//.test(realpath),
    real.code === 0 ? `realpath=${realpath === '' ? '<empty>' : realpath}` : probeFailure(real))

  const pkgVersions = runtimeExec(
    'P="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"; ' +
    'node -e \'const p=process.argv[1];console.log(require(p+"/package.json").version);' +
    'console.log(require(p+"/node_modules/@deepseek-ai/dsh-mcp-client/package.json").version)\' "$P"',
  )
  const [kernelVersion, mcpVersion] = pkgVersions.stdout.split('\n')
  assert(entry, 'realpath 父目录的 dsh 包清单 = rc.5',
    pkgVersions.code === 0 && kernelVersion === TARGET_VERSION,
    pkgVersions.code === 0 ? `version=${kernelVersion ?? '<empty>'}` : probeFailure(pkgVersions))
  assert(entry, 'dsh-mcp-client 与内核同版（dsh 安装目录内）',
    pkgVersions.code === 0 && typeof mcpVersion === 'string' && mcpVersion === kernelVersion,
    pkgVersions.code === 0 ? `mcp-client=${mcpVersion ?? '<empty>'} kernel=${kernelVersion ?? '<empty>'}` : probeFailure(pkgVersions))

  /* ENV-005 node 版本 + 根 package.json engines.node */
  const nodeVersion = runtimeExec('node -v')
  const nodeOk = nodeVersion.code === 0 && semverAtLeast(nodeVersion.stdout, '24.9.0')
  let engines = '(读取失败)'
  try {
    engines = String(readJson(join(repoRoot, 'package.json')).engines?.node ?? '(无 engines.node)')
  } catch { /* 记录为读取失败 */ }
  const enginesFloor = engines.match(/^>=\s*(\d+\.\d+\.\d+)$/)
  const enginesOk = enginesFloor !== null && enginesFloor[1] === '24.9.0'
  assert(entry, 'node -v ≥ 24.9（镜像实测）',
    nodeOk,
    nodeVersion.code === 0 ? `node ${nodeVersion.stdout}（下限 24.9.0）` : probeFailure(nodeVersion))
  assert(entry, '根 package.json engines.node = >=24.9.0',
    enginesOk,
    `engines.node=${engines}`)

  /* T48 v1 剥离（运行层复核） */
  const strip = runtimeExec(
    'for p in core basis.yml ' + BASIS_PACKAGES.map(name => `packages/${name}`).join(' ') + '; do ' +
    'test -e "/repo/$p" && echo "PRESENT /repo/$p" || echo "absent /repo/$p"; done',
  )
  const present = strip.code === 0
    ? strip.stdout.split('\n').filter(line => line.startsWith('PRESENT'))
    : ['(探针失败)']
  assert(entry, 'v1 剥离：core/、basis.yml、6 个 @basis 包均不在运行镜像',
    strip.code === 0 && present.length === 0,
    strip.code === 0
      ? (present.length === 0 ? '/repo 下 8 项全部 absent' : `仍存在: ${present.map(line => line.slice(8)).join(', ')}`)
      : probeFailure(strip))

  /* 夹具不进镜像（T46 约束；.dockerignore 缺口另记 leftover） */
  const fixtures = runtimeExec('test -e /repo/tests/fixtures && echo present || echo absent')
  assert(entry, 'tests/fixtures 不在镜像内',
    fixtures.code === 0 && fixtures.stdout === 'absent',
    fixtures.code === 0 ? `/repo/tests/fixtures=${fixtures.stdout}` : probeFailure(fixtures))

  /* T48 镜像 digest/体积（信息面，同时锁证据身份） */
  const inspect = runtimeTarget.kind === 'container'
    ? spawnSync('docker', ['inspect', runtimeTarget.name, '--format', '{{.Image}}'], { encoding: 'utf8', timeout: 20_000 })
    : spawnSync('docker', ['image', 'inspect', runtimeTarget.name, '--format', '{{.Id}} {{.Size}}'], { encoding: 'utf8', timeout: 20_000 })
  let identity = (inspect.stdout ?? '').trim()
  if (runtimeTarget.kind === 'container' && inspect.status === 0 && identity !== '') {
    const imageInspect = spawnSync('docker', ['image', 'inspect', identity, '--format', '{{.Id}} {{.Size}}'], { encoding: 'utf8', timeout: 20_000 })
    identity = identity === '' ? identity : `${identity} ${(imageInspect.stdout ?? '').trim()}`
  }
  assert(entry, '镜像 digest/体积可记录',
    inspect.status === 0 && identity !== '',
    identity === '' ? `docker inspect 失败 exit=${inspect.status}` : identity)

  entry.scannedFiles = 0
  return entry
}

function checkRuntimeOffice() {
  const entry = section('RC5-OFF-004/005', '镜像字体与 Python 探针（OFF-004/005）',
    `目标=${runtimeTarget.kind}:${runtimeTarget.name}`)

  for (const family of ['Noto Sans CJK', 'Liberation', 'DejaVu']) {
    const fonts = runtimeExec(`fc-list | grep -ci '${family}'`)
    const count = Number.parseInt(fonts.stdout, 10)
    assert(entry, `fc-list 含 ${family}`,
      fonts.code === 0 && Number.isFinite(count) && count > 0,
      fonts.code === 0 ? `match=${fonts.stdout}` : probeFailure(fonts))
  }

  const python = runtimeExec(
    'python3 -c "import docx, openpyxl, pptx; ' +
    'print(\'docx\', getattr(docx, \'__version__\', \'?\'), ' +
    '\'openpyxl\', getattr(openpyxl, \'__version__\', \'?\'), ' +
    '\'pptx\', getattr(pptx, \'__version__\', \'?\'))"',
  )
  assert(entry, 'python3 可 import docx/openpyxl/pptx',
    python.code === 0,
    python.code === 0 ? python.stdout : probeFailure(python))

  /* entrypoint 渲染锁依赖 util-linux，缺失会在 ACP 启动时才炸，提前探。 */
  const flock = runtimeExec('command -v flock')
  assert(entry, 'flock 存在（entrypoint 渲染锁）',
    flock.code === 0 && flock.stdout !== '',
    flock.code === 0 ? flock.stdout : probeFailure(flock))

  return entry
}

function checkComposeConfig() {
  const entry = section('RC5-COMPOSE', 'compose 参数化 config（T43/T48）',
    '`docker compose --env-file <测试 env> -f docker-compose.yml config`，不启动容器。')
  const result = spawnSync('docker', [
    'compose', '--env-file', composeEnvFile, '-f', join(repoRoot, 'docker-compose.yml'), 'config',
  ], { encoding: 'utf8', timeout: 60_000 })
  const output = result.stdout ?? ''
  const dataBind = /source:\s*(\S+)\s*\n\s*target:\s*\/data\b/.exec(output)
  const source = dataBind?.[1] ?? ''
  assert(entry, 'compose config 退出码 0', result.status === 0,
    result.status === 0 ? 'ok' : `exit=${result.status} err=${(result.stderr ?? '').split('\n')[0].slice(0, 200)}`)
  assert(entry, '/data 为 bind（source 非空）', dataBind !== null,
    dataBind === null ? 'config 输出未找到 source→target:/data 绑定' : `source=${source}`)
  return entry
}

/* ------------------------------------------------------------ 主流程 */

checkSelfTest()
checkEnv003()
checkEnv002()
checkEnv006()
checkEnv004()
if (runtimeTarget !== undefined) {
  checkRuntimeEnv()
  checkRuntimeOffice()
}
if (composeEnvFile !== undefined) {
  checkComposeConfig()
}
if (apiStatic) {
  checkApi008()
  checkApi009()
}

const blockers = sections.flatMap(item => item.blockers.map(message => `${item.id}: ${message}`))
const warnings = sections.flatMap(item => item.warnings.map(message => `${item.id}: ${message}`))

for (const item of sections) {
  const badge = item.status === 'pass' ? 'PASS' : item.status === 'warn' ? 'WARN' : 'FAIL'
  console.log(`\n== ${item.id} [${badge}] ${item.title}`)
  if (item.note !== undefined) console.log(`   口径:${item.note}`)
  for (const assertion of item.assertions) {
    console.log(`   ${assertion.ok ? '✓' : '✗'} ${assertion.name} — ${assertion.detail}`)
  }
  for (const message of item.warnings) console.log(`   ! ${message}`)
  if (item.hits.length > 0 && item.status !== 'pass') {
    console.log(`   命中(${item.hits.length}):`)
    for (const rec of item.hits.slice(0, 60)) console.log(`     - ${rec.path}:${rec.line} [${rec.token}/${rec.kind}] ${rec.text}`)
    if (item.hits.length > 60) console.log(`     … 其余 ${item.hits.length - 60} 条见 JSON`)
  }
  if (item.informational !== undefined && (item.informational.comments.length > 0 || item.informational.docs.length > 0)) {
    console.log(`   信息面:注释 ${item.informational.comments.length} 条 / 文档 ${item.informational.docs.length} 条(不计门禁,明细见 JSON)`)
  }
}

const report = {
  script: 'scripts/verify-rc5-env.mjs',
  generatedAt: new Date().toISOString(),
  node: process.version,
  targets: { dsh: TARGET_VERSION, cordis: TARGET_CORDIS, cosmokit: TARGET_COSMOKIT },
  runtime: runtimeTarget ?? 'not-run',
  composeEnvFile: composeEnvFile ?? null,
  mode: [
    'env',
    ...(apiStatic ? ['api-static'] : []),
    ...(runtimeTarget === undefined ? [] : [`runtime-${runtimeTarget.kind}`]),
    ...(composeEnvFile === undefined ? [] : ['compose-config']),
  ].join('+'),
  sections,
  summary: {
    pass: sections.filter(item => item.status === 'pass').length,
    warn: sections.filter(item => item.status === 'warn').length,
    fail: sections.filter(item => item.status === 'fail').length,
    blockers,
    warnings,
  },
}

console.log('\n== 汇总')
console.log(`   ${report.summary.pass} PASS / ${report.summary.warn} WARN / ${report.summary.fail} FAIL`)
if (warnings.length > 0) console.log(`   WARN ${warnings.length} 条:\n     - ${warnings.join('\n     - ')}`)
if (blockers.length > 0) console.log(`   FAIL ${blockers.length} 条:\n     - ${blockers.join('\n     - ')}`)
console.log(blockers.length === 0 ? '\nEXIT 0(硬门禁全过)' : '\nEXIT 1(有硬门禁失败)')

if (jsonPath !== undefined) {
  const abs = resolve(process.cwd(), jsonPath)
  writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`报告:${abs}`)
}

process.exit(blockers.length === 0 ? 0 : 1)