/**
 * Skill 文件库(个人 + 共享):文件系统即事实源,不新增 users.db 表。
 *
 * 目录形态:
 *   <tenantRoot>/<account>/.eterna/skills/<name>/SKILL.md  个人(在用户沙箱内)
 *   <accessDir>/skills/shared/<name>/SKILL.md               共享(access 卷)
 *   <tenantRoot>/<account>/.eterna/skill-cache/<name>/      共享资源按用户懒拷贝
 *
 * 每个技能目录可有 `.skill-meta.json`(enabled/origin/installedAt/updatedAt);
 * 缺失按启用处理,损坏也不阻断技能加载(只影响开关与来源徽标)。
 *
 * 安全:
 * - name 先过 kebab-case 校验,路径只由根 + name 拼接;读写前 realpath 判根
 *   (within-root.ts),技能目录/SKILL.md 本身是 symlink 一律拒绝;
 * - 所有写入原子(同目录临时文件 + rename);zip 先解到 `.tmp-<uuid>` 再整体
 *   改名,失败清理;
 * - 列表只读 SKILL.md 前 16KB 取 frontmatter(描述上限 2KB),正文读取上限 512KB;
 * - 文件计数遍历不跟 symlink、上限 500 条,避免异常目录拖死 UI。
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { parseSkillMarkdown, skillNameIssue, SkillFormatError, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, type ParsedSkillMarkdown } from './skill-format.ts'
import {
  readSkillZip, SKILL_ZIP_MAX_BYTES, SKILL_ZIP_MAX_ENTRIES, SKILL_ZIP_MAX_ENTRY_BYTES, SKILL_ZIP_MAX_UNCOMPRESSED,
} from './skill-zip.ts'
import { withinRoot } from './within-root.ts'

export type SkillScope = 'personal' | 'shared'

/** 个人技能上限。 */
export const SKILL_PERSONAL_MAX = 32
/** 共享技能上限。 */
export const SKILL_SHARED_MAX = 64
/** SKILL.md 正文读取上限(字节)。 */
export const SKILL_MARKDOWN_MAX = 512 * 1024
/** 列表只读的 frontmatter 头部上限(字节)。 */
export const SKILL_HEAD_MAX = 16 * 1024
/** `.skill-meta.json` 读取上限(字节)。 */
const SKILL_META_MAX = 16 * 1024
/** 资源遍历条目上限。 */
const SKILL_MEASURE_MAX = 500

export type SkillErrorCode = 'invalid' | 'conflict' | 'limit' | 'not-found' | 'unavailable'

/** 业务错误(路由层按 code 映射 RPC 错误帧)。 */
export class SkillStoreError extends Error {
  readonly code: SkillErrorCode

  constructor(code: SkillErrorCode, message: string) {
    super(message)
    this.name = 'SkillStoreError'
    this.code = code
  }
}

/** 列表/卡片视图(不含磁盘路径)。 */
export interface SkillItem {
  readonly scope: SkillScope
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly enabled: boolean
  readonly origin: string
  readonly files: number
  readonly bytes: number
  readonly updatedAt: number
}

/** 内部条目(provider 用,含技能目录)。 */
export interface SkillEntry extends SkillItem {
  readonly dir: string
}

interface SkillMeta {
  readonly enabled?: boolean
  readonly origin?: string
  readonly installedAt?: number
  readonly updatedAt?: number
}

export interface SkillStoreDeps {
  readonly tenantRoot: string
  readonly accessDir: string
  readonly logger?: { warn(message: string): void } | undefined
}

/** 默认/当前 meta 读取结果。 */
function readMeta(dir: string): SkillMeta {
  const path = join(dir, '.skill-meta.json')
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > SKILL_META_MAX) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const row = parsed as Record<string, unknown>
    return {
      ...(typeof row.enabled === 'boolean' ? { enabled: row.enabled } : {}),
      ...(typeof row.origin === 'string' && row.origin !== '' ? { origin: row.origin } : {}),
      ...(typeof row.installedAt === 'number' ? { installedAt: row.installedAt } : {}),
      ...(typeof row.updatedAt === 'number' ? { updatedAt: row.updatedAt } : {}),
    }
  } catch {
    return {}
  }
}

/** 统一把格式错误映射成可路由的业务错误。 */
function parseStrict(markdown: string): ParsedSkillMarkdown {
  try {
    return parseSkillMarkdown(markdown)
  } catch (error) {
    if (error instanceof SkillFormatError) throw new SkillStoreError('invalid', error.message)
    throw error
  }
}

/** 原子写(同目录临时文件 + rename;失败清理临时文件)。 */
function atomicWrite(path: string, data: string | Buffer): void {
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, data, { mode: 0o644 })
    renameSync(temp, path)
  } catch (error) {
    try { rmSync(temp, { force: true }) } catch { /* 清理失败不掩盖原错误 */ }
    throw error
  }
}

/** 写 meta(合并未知键,保留未来字段)。 */
function writeMeta(dir: string, patch: SkillMeta): void {
  const current = readMeta(dir)
  const next = { ...current, ...patch }
  atomicWrite(join(dir, '.skill-meta.json'), `${JSON.stringify(next, null, 2)}\n`)
}

/** 目录是否真实目录且非 symlink。 */
function realDir(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** 文件是否真实文件且非 symlink。 */
function realFile(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** 只读文件头部(列表不把整份正文读进内存)。 */
function readHead(path: string, maxBytes: number): string | undefined {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = lstatSync(path).size
    const buffer = Buffer.alloc(Math.min(size, maxBytes))
    const read = buffer.length === 0 ? 0 : readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch { /* 关闭失败不影响读取结果 */ }
    }
  }
}

/** 只读 frontmatter 头(正文不读)。 */
function readSkillHead(path: string): ParsedSkillMarkdown | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined
    const head = readHead(path, Math.min(stat.size, SKILL_HEAD_MAX))
    if (head === undefined) return undefined
    const lines = head.split(/\r?\n/u)
    let closing = -1
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index] === '---') { closing = index; break }
    }
    if (closing < 0) return undefined
    return parseSkillMarkdown(lines.slice(0, closing + 1).join('\n'))
  } catch {
    return undefined
  }
}

/** 统计文件数/字节(不跟 symlink,条目上限 500)。 */
function measureDir(dir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  const stack = [dir]
  while (stack.length > 0 && files < SKILL_MEASURE_MAX) {
    const current = stack.pop() as string
    let entries
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (files >= SKILL_MEASURE_MAX) break
      if (entry.name === '.skill-meta.json' || entry.name === '.eterna-source') continue
      const path = join(current, entry.name)
      let stat
      try { stat = lstatSync(path) } catch { continue }
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) { stack.push(path); continue }
      if (!stat.isFile()) continue
      files += 1
      bytes += stat.size
    }
  }
  return { files, bytes }
}

/** 目录签名(共享缓存失效判定;不含 meta)。 */
function signatureOf(dir: string): string | undefined {
  const hash = createHash('sha256')
  const files: string[] = []
  const stack: Array<{ readonly path: string; readonly rel: string }> = [{ path: dir, rel: '' }]
  while (stack.length > 0) {
    const current = stack.pop() as { path: string; rel: string }
    let entries
    try { entries = readdirSync(current.path, { withFileTypes: true }) } catch { return undefined }
    for (const entry of entries) {
      if (entry.name === '.skill-meta.json' || entry.name === '.eterna-source') continue
      const path = join(current.path, entry.name)
      const rel = current.rel === '' ? entry.name : `${current.rel}/${entry.name}`
      let stat
      try { stat = lstatSync(path) } catch { return undefined }
      if (stat.isSymbolicLink()) return undefined
      if (stat.isDirectory()) { stack.push({ path, rel }); continue }
      if (!stat.isFile()) return undefined
      files.push(`${rel}\u0000${stat.size}\u0000${stat.mtimeMs}`)
    }
  }
  files.sort()
  for (const file of files) hash.update(`${file}\n`)
  return hash.digest('hex')
}

/** 递归拷贝(拒绝 symlink;保留相对路径)。 */
function copySkillDir(source: string, target: string): void {
  mkdirSync(target, { recursive: true, mode: 0o755 })
  const stack: Array<{ readonly from: string; readonly to: string }> = [{ from: source, to: target }]
  while (stack.length > 0) {
    const current = stack.pop() as { from: string; to: string }
    for (const entry of readdirSync(current.from, { withFileTypes: true })) {
      if (entry.name === '.skill-meta.json' || entry.name === '.eterna-source') continue
      const from = join(current.from, entry.name)
      const to = join(current.to, entry.name)
      const stat = lstatSync(from)
      if (stat.isSymbolicLink()) throw new SkillStoreError('unavailable', '共享技能包含符号链接，已拒绝')
      if (stat.isDirectory()) {
        mkdirSync(to, { recursive: true, mode: 0o755 })
        stack.push({ from, to })
        continue
      }
      if (!stat.isFile()) continue
      atomicWrite(to, readFileSync(from))
    }
  }
}

/**
 * Skill 文件库。所有公开方法都以 account(服务端从会话解析)为边界;
 * 客户端不能传 account/根路径。
 */
export class SkillStore {
  readonly #tenantRoot: string
  readonly #sharedRoot: string
  readonly #logger: { warn(message: string): void } | undefined
  #available = false

  constructor(deps: SkillStoreDeps) {
    this.#tenantRoot = deps.tenantRoot
    this.#sharedRoot = join(deps.accessDir, 'skills', 'shared')
    this.#logger = deps.logger
    try {
      mkdirSync(this.#sharedRoot, { recursive: true, mode: 0o755 })
      this.#available = true
    } catch (error) {
      this.#logger?.warn(`skills: 共享技能目录不可用(管理面降级): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 共享目录是否就绪;false=管理面返回 503,provider 不挂载。 */
  get available(): boolean { return this.#available }

  /** 个人技能根(不建目录;写入时按需建)。账号必须仍是 tenantRoot 内的单段目录。 */
  personalRoot(account: string): string {
    if (account === '' || account === '.' || account === '..') {
      throw new SkillStoreError('invalid', '账号非法')
    }
    const root = join(this.#tenantRoot, account, '.eterna', 'skills')
    if (!withinRoot(root, this.#tenantRoot)) throw new SkillStoreError('invalid', '账号路径越界')
    return root
  }

  /** 共享技能根。 */
  sharedRoot(): string {
    return this.#sharedRoot
  }

  /** 缓存的共享资源目录(provider get 用);无法按用户缓存时返回 undefined(不泄露宿主共享路径)。 */
  resourceDir(entry: SkillEntry, account: string | undefined): string | undefined {
    if (entry.scope === 'personal') return entry.dir
    if (account === undefined) return undefined
    return this.#ensureSharedCache(account, entry.name, entry.dir)
  }

  /** 按角色列个人技能(includeDisabled=false 时过滤停用)。 */
  listPersonal(account: string, includeDisabled = true, measure = true): SkillEntry[] {
    return this.listPersonalStatus(account, includeDisabled, measure).entries
  }

  /** 列个人技能 + 观测完整性(provider 用;读目录失败=complete:false)。 */
  listPersonalStatus(account: string, includeDisabled = true, measure = true): { entries: SkillEntry[]; complete: boolean } {
    if (!this.#available) return { entries: [], complete: false }
    return this.#scan(this.personalRoot(account), 'personal', includeDisabled, measure)
  }

  /** 列共享技能(includeDisabled 由路由按角色给)。 */
  listShared(includeDisabled = true, measure = true): SkillEntry[] {
    return this.listSharedStatus(includeDisabled, measure).entries
  }

  /** 列共享技能 + 观测完整性。 */
  listSharedStatus(includeDisabled = true, measure = true): { entries: SkillEntry[]; complete: boolean } {
    if (!this.#available) return { entries: [], complete: false }
    return this.#scan(this.#sharedRoot, 'shared', includeDisabled, measure)
  }

  /** 读一条技能(含全文;停用也可读,供编辑器)。 */
  read(scope: SkillScope, account: string, name: string): { entry: SkillEntry; markdown: string } {
    const dir = this.#dirOf(scope, account, name, false)
    const skillPath = join(dir, 'SKILL.md')
    if (!realFile(skillPath)) throw new SkillStoreError('not-found', `技能 ${name} 不存在`)
    const size = statSync(skillPath).size
    if (size > SKILL_MARKDOWN_MAX) {
      throw new SkillStoreError('invalid', `SKILL.md 不能超过 ${SKILL_MARKDOWN_MAX / 1024}KB`)
    }
    const markdown = readFileSync(skillPath, 'utf8')
    const parsed = parseStrict(markdown)
    if (parsed.name !== name) {
      throw new SkillStoreError('invalid', `SKILL.md 的 name 与目录名不一致（${parsed.name} ≠ ${name}）`)
    }
    const meta = readMeta(dir)
    return {
      entry: {
        scope,
        name,
        description: parsed.description,
        ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        enabled: meta.enabled !== false,
        origin: meta.origin ?? 'installed',
        ...measureDir(dir),
        updatedAt: Math.round(meta.updatedAt ?? statSync(skillPath).mtimeMs),
        dir,
      },
      markdown,
    }
  }

  /**
   * 新建/编辑 SKILL.md。expectedName 存在=编辑(名称不可改),缺席=新建。
   * @throws SkillStoreError conflict/limit/invalid
   */
  save(scope: SkillScope, account: string, markdown: string, expectedName?: string): SkillEntry {
    const bytes = Buffer.byteLength(markdown, 'utf8')
    if (bytes > SKILL_MARKDOWN_MAX) {
      throw new SkillStoreError('invalid', `SKILL.md 不能超过 ${SKILL_MARKDOWN_MAX / 1024}KB`)
    }
    const parsed = parseStrict(markdown)
    if (expectedName !== undefined && parsed.name !== expectedName) {
      throw new SkillStoreError('invalid', '技能名不可修改；如需改名请新建后删除旧技能')
    }
    const root = this.#rootOf(scope, account, true)
    const target = join(root, parsed.name)
    const exists = realDir(target)
    if (expectedName === undefined && exists) {
      throw new SkillStoreError('conflict', `技能 ${parsed.name} 已存在`)
    }
    if (expectedName !== undefined && !exists) {
      throw new SkillStoreError('not-found', `技能 ${expectedName} 不存在`)
    }
    this.#assertQuota(root, scope, exists)
    if (!exists) this.#assertSafeTarget(root, target)
    if (exists) {
      atomicWrite(join(target, 'SKILL.md'), markdown)
      writeMeta(target, { enabled: readMeta(target).enabled !== false, updatedAt: Date.now() })
      return this.#entryRequired(target, scope)
    }
    const temp = join(root, `.tmp-${randomUUID()}`)
    try {
      mkdirSync(temp, { recursive: true, mode: 0o755 })
      atomicWrite(join(temp, 'SKILL.md'), markdown)
      writeMeta(temp, { enabled: true, origin: 'form', installedAt: Date.now(), updatedAt: Date.now() })
      renameSync(temp, target)
    } catch (error) {
      try { rmSync(temp, { recursive: true, force: true }) } catch { /* 清理失败不掩盖原错误 */ }
      throw error
    }
    return this.#entryRequired(target, scope)
  }

  /** 安装单 .md(与 save 同结构,origin 默认 upload-md;市场安装传 market)。 */
  installMarkdown(scope: SkillScope, account: string, content: string, origin = 'upload-md'): SkillEntry {
    const entry = this.save(scope, account, content)
    const dir = this.#dirOf(scope, account, entry.name, false)
    writeMeta(dir, { origin })
    return { ...entry, origin }
  }

  /** 安装 zip(单技能;可含 references/resources)。origin 默认 upload-zip。 */
  installZip(scope: SkillScope, account: string, bytes: Buffer, origin = 'upload-zip'): SkillEntry {
    if (bytes.length > SKILL_ZIP_MAX_BYTES) {
      throw new SkillStoreError('invalid', `zip 不能超过 ${SKILL_ZIP_MAX_BYTES / 1024 / 1024}MB`)
    }
    const files = readSkillZip(bytes)
    const base = skillBaseOf(files)
    const skillFile = files.find(file => file.path === (base === '' ? 'SKILL.md' : `${base}/SKILL.md`))
    if (skillFile === undefined) throw new SkillStoreError('invalid', 'zip 根目录缺少 SKILL.md')
    if (skillFile.data.length > SKILL_MARKDOWN_MAX) {
      throw new SkillStoreError('invalid', `SKILL.md 不能超过 ${SKILL_MARKDOWN_MAX / 1024}KB`)
    }
    const markdown = skillFile.data.toString('utf8')
    const parsed = parseStrict(markdown)
    const root = this.#rootOf(scope, account, true)
    const target = join(root, parsed.name)
    if (realDir(target)) throw new SkillStoreError('conflict', `技能 ${parsed.name} 已存在`)
    this.#assertQuota(root, scope, false)
    this.#assertSafeTarget(root, target)
    const temp = join(root, `.tmp-${randomUUID()}`)
    try {
      mkdirSync(temp, { recursive: true, mode: 0o755 })
      let total = 0
      let count = 0
      for (const file of files) {
        const rel = base === '' ? file.path : file.path.startsWith(`${base}/`) ? file.path.slice(base.length + 1) : undefined
        if (rel === undefined || rel === '') continue
        if (rel === '.skill-meta.json' || rel === '.eterna-source') continue
        if (rel.includes('/')) mkdirSync(join(temp, ...rel.split('/').slice(0, -1)), { recursive: true, mode: 0o755 })
        atomicWrite(join(temp, ...rel.split('/')), file.data)
        total += file.data.length
        count += 1
      }
      if (count === 0) throw new SkillStoreError('invalid', 'zip 内没有可安装的文件')
      if (total > SKILL_ZIP_MAX_UNCOMPRESSED || count > SKILL_ZIP_MAX_ENTRIES) {
        throw new SkillStoreError('invalid', 'zip 内容超过技能包上限')
      }
      // 以 SKILL.md 原文落盘(上面逐条写入已包含它)
      writeMeta(temp, { enabled: true, origin, installedAt: Date.now(), updatedAt: Date.now() })
      renameSync(temp, target)
    } catch (error) {
      try { rmSync(temp, { recursive: true, force: true }) } catch { /* 同上 */ }
      throw error
    }
    return this.#entryRequired(target, scope)
  }

  /** 启停(meta.enabled;不改文件内容)。 */
  toggle(scope: SkillScope, account: string, name: string, enabled: boolean): SkillEntry {
    const dir = this.#dirOf(scope, account, name, false)
    if (!realDir(dir)) throw new SkillStoreError('not-found', `技能 ${name} 不存在`)
    writeMeta(dir, { enabled, updatedAt: Date.now() })
    return this.#entryRequired(dir, scope)
  }

  /** 删除整目录(含资源)。 */
  delete(scope: SkillScope, account: string, name: string): void {
    const dir = this.#dirOf(scope, account, name, false)
    if (!realDir(dir)) throw new SkillStoreError('not-found', `技能 ${name} 不存在`)
    rmSync(dir, { recursive: true, force: true })
  }

  /** 用户删除清账:移除个人技能与共享资源缓存(失败只记 warn)。 */
  removeUserRoots(account: string): void {
    try { this.personalRoot(account) } catch { return }
    const base = join(this.#tenantRoot, account, '.eterna')
    for (const name of ['skills', 'skill-cache']) {
      try { rmSync(join(base, name), { recursive: true, force: true }) } catch (error) {
        this.#logger?.warn(`skills: 清理用户 ${account} 的 ${name} 失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** 生成视图(provider 用;measure=false 时不遍历资源)。 */
  #scan(root: string, scope: SkillScope, includeDisabled: boolean, measure: boolean): { entries: SkillEntry[]; complete: boolean } {
    if (!realDir(root)) return { entries: [], complete: true }
    const entries: SkillEntry[] = []
    let children
    try { children = readdirSync(root, { withFileTypes: true }) } catch { return { entries: [], complete: false } }
    for (const child of children) {
      if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.')) continue
      const entry = this.#entryOf(join(root, child.name), scope, measure)
      if (entry === undefined) continue
      if (!entry.enabled && !includeDisabled) continue
      entries.push(entry)
    }
    return {
      entries: entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
      complete: true,
    }
  }

  /** 写入后必须可读;不可读说明磁盘内容异常(fail-loud,避免返回半成品)。 */
  #entryRequired(dir: string, scope: SkillScope): SkillEntry {
    const entry = this.#entryOf(dir, scope, true)
    if (entry === undefined) throw new SkillStoreError('invalid', '技能写入后校验失败')
    return entry
  }

  /** 单目录 → 条目;无效/超长/名字不符返回 undefined(不阻断其余技能)。 */
  #entryOf(dir: string, scope: SkillScope, measure: boolean): SkillEntry | undefined {
    if (!realDir(dir)) return undefined
    const skillPath = join(dir, 'SKILL.md')
    const parsed = readSkillHead(skillPath)
    if (parsed === undefined) return undefined
    if (parsed.name !== basename(dir)) return undefined
    const meta = readMeta(dir)
    let stat: { mtimeMs: number }
    try { stat = statSync(skillPath) } catch { return undefined }
    const measured = measure ? measureDir(dir) : { files: 0, bytes: 0 }
    return {
      scope,
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      enabled: meta.enabled !== false,
      origin: meta.origin ?? 'installed',
      ...measured,
      updatedAt: Math.round(meta.updatedAt ?? stat.mtimeMs),
      dir,
    }
  }

  /** 解析并校验技能目录(读写统一入口)。 */
  #dirOf(scope: SkillScope, account: string, name: string, createRoot: boolean): string {
    const issue = skillNameIssue(name)
    if (issue !== undefined) throw new SkillStoreError('invalid', issue)
    const root = this.#rootOf(scope, account, createRoot)
    const dir = join(root, name)
    if (!withinRoot(dir, root)) throw new SkillStoreError('invalid', '技能路径越界')
    if (existsSync(dir) && !realDir(dir)) throw new SkillStoreError('invalid', '技能目录不是普通目录')
    return dir
  }

  #rootOf(scope: SkillScope, account: string, create: boolean): string {
    if (!this.#available) throw new SkillStoreError('unavailable', '技能存储不可用')
    if (scope === 'shared') return this.#sharedRoot
    if (account === '') throw new SkillStoreError('invalid', '账号为空')
    const root = this.personalRoot(account)
    if (create) mkdirSync(root, { recursive: true, mode: 0o755 })
    return root
  }

  #assertQuota(root: string, scope: SkillScope, editing: boolean): void {
    if (editing) return
    const limit = scope === 'personal' ? SKILL_PERSONAL_MAX : SKILL_SHARED_MAX
    const count = this.#scan(root, scope, true, false).entries.length
    if (count >= limit) {
      throw new SkillStoreError('limit', scope === 'personal'
        ? `每人最多 ${limit} 个个人技能`
        : `共享技能最多 ${limit} 个`)
    }
  }

  /** 目标目录若已存在但为空/非法,拒绝;新建路径必须在根内。 */
  #assertSafeTarget(root: string, target: string): void {
    if (!withinRoot(target, root)) throw new SkillStoreError('invalid', '技能路径越界')
    if (existsSync(target)) {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new SkillStoreError('conflict', '同名路径已存在且不是技能目录')
      }
      if (readdirSync(target).length > 0) throw new SkillStoreError('conflict', '同名技能已存在')
    }
  }

  /** 共享技能资源按用户懒拷贝(签名未变则复用)。 */
  #ensureSharedCache(account: string, name: string, sourceDir: string): string | undefined {
    const signature = signatureOf(sourceDir)
    if (signature === undefined) return undefined
    const userRoot = join(this.#tenantRoot, account)
    if (!withinRoot(userRoot, this.#tenantRoot)) return undefined
    const cacheRoot = join(userRoot, '.eterna', 'skill-cache')
    const target = join(cacheRoot, name)
    try {
      mkdirSync(cacheRoot, { recursive: true, mode: 0o755 })
      if (realDir(target) && realFile(join(target, '.eterna-source'))) {
        const stored = readFileSync(join(target, '.eterna-source'), 'utf8').trim()
        if (stored === signature && realFile(join(target, 'SKILL.md'))) return target
      }
      rmSync(target, { recursive: true, force: true })
      copySkillDir(sourceDir, target)
      atomicWrite(join(target, '.eterna-source'), `${signature}\n`)
      return target
    } catch (error) {
      this.#logger?.warn(`skills: 共享技能 ${name} 资源缓存失败: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
}

/** zip 根目录归一:根有 SKILL.md 或以单层文件夹包住整包。 */
function skillBaseOf(files: readonly { readonly path: string }[]): string {
  if (files.some(file => file.path === 'SKILL.md')) return ''
  const firstSegments = new Set(files.map(file => file.path.split('/')[0]))
  if (firstSegments.size === 1) {
    const base = [...firstSegments][0] as string
    if (files.some(file => file.path === `${base}/SKILL.md`)) return base
  }
  throw new SkillStoreError('invalid', 'zip 根目录需包含 SKILL.md（可整体放在一个文件夹内）')
}

/** 导出上限供 UI/路由文案复用。 */
export const SKILL_LIMITS = {
  personal: SKILL_PERSONAL_MAX,
  shared: SKILL_SHARED_MAX,
  markdownBytes: SKILL_MARKDOWN_MAX,
  zipBytes: SKILL_ZIP_MAX_BYTES,
  zipUncompressedBytes: SKILL_ZIP_MAX_UNCOMPRESSED,
  zipEntries: SKILL_ZIP_MAX_ENTRIES,
  zipEntryBytes: SKILL_ZIP_MAX_ENTRY_BYTES,
  nameMax: SKILL_NAME_MAX,
  descriptionMax: SKILL_DESCRIPTION_MAX,
} as const
