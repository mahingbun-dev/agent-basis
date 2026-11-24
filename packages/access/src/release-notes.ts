/**
 * 版本更新介绍弹窗 —— Host 半边(55 号 §4.2)。
 *
 * 职责三件(全部无状态、可单测):
 *  1. 清单目录:读 `releases/<version>/release.json` + 仓库根 `VERSION`;
 *  2. 已读账本:`release_notes_seen` 表由 UserStore 持有,本文件只定 via 白名单;
 *  3. 资产守卫:只放行该版本 `assets/` 目录里真实存在、扩展名白名单内的文件。
 *
 * 纪律:
 * - 清单解析失败**不拦启动**(弹窗是装饰性能力,不能把产品弄挂,55 号 §6);
 *   但问题会记进 `problems`,由调用方落审计。
 * - 清单里的 `media.src` 只写文件名;路径拼装与穿越拒绝都在本文件,
 *   路由层拿到的永远是 `{ bytes, contentType }`。
 * - 零第三方依赖(内置 fs/path),与 access 其余 host 半边一致。
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 语义化版本(允许预发布后缀,如 0.2.1-rc.1)。 */
export const RELEASE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9a-z.]+)?$/

/** `POST /access/api/release-notes/seen` 的合法关闭原因(55 号 §2.2)。 */
export const RELEASE_SEEN_VIA = ['done', 'skip', 'close', 'esc', 'backdrop'] as const
export type ReleaseSeenVia = (typeof RELEASE_SEEN_VIA)[number]

export function isReleaseSeenVia(value: unknown): value is ReleaseSeenVia {
  return typeof value === 'string' && (RELEASE_SEEN_VIA as readonly string[]).includes(value)
}

export interface ReleaseMedia {
  readonly src: string
  readonly alt: string
  readonly caption?: string
  /** 动图文件名(webm);存在时同目录必须有同名 poster(`src`)。 */
  readonly motion?: string
  readonly sha256?: string
  /** 「本页无 GUI 可截」时的说明(门禁要求的诚实字段)。 */
  readonly notes?: string
}

export interface ReleaseLink {
  readonly label: string
  readonly note?: string
  /** `settings.release-notes` | `docs.user-guide` —— 客户端白名单动作。 */
  readonly action: string
}

export type ReleaseSlideKind = 'cover' | 'feature' | 'end'

export interface ReleaseSlide {
  readonly id: string
  readonly kind: ReleaseSlideKind
  readonly kicker?: string
  readonly title: string
  readonly body?: string
  readonly facts?: readonly string[]
  readonly media?: ReleaseMedia
  readonly links?: readonly ReleaseLink[]
  readonly footerNote?: string
}

export interface ReleaseHighlight {
  readonly n: string
  readonly text: string
}

export interface ReleaseManifest {
  readonly version: string
  readonly releasedAt: string
  readonly announce: boolean
  readonly theme: string
  readonly summary: string
  readonly highlights: readonly ReleaseHighlight[]
  readonly slides: readonly ReleaseSlide[]
}

/** 列表项(不含 slides,历史列表用)。 */
export interface ReleaseSummary {
  readonly version: string
  readonly releasedAt: string
  readonly theme: string
  readonly announce: boolean
}

/** 资产响应的最小契约(路由层直接喂给 AccessReply)。 */
export interface ReleaseAsset {
  readonly bytes: Uint8Array
  readonly contentType: string
}

const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webm: 'video/webm',
}

/** 资产上限 8MB(清单侧规范是 ≤600KB/图、≤2MB/动图;此处只兜住失控值)。 */
const ASSET_MAX_BYTES = 8 * 1024 * 1024

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function optionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined
}

function parseMedia(value: unknown, problems: string[], where: string): ReleaseMedia | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    problems.push(`${where}: media 必须是对象`)
    return undefined
  }
  const src = value.src
  if (!isNonEmptyString(src) || src.includes('/') || src.includes('\\') || src.startsWith('.')) {
    problems.push(`${where}: media.src 只允许文件名(${String(src)})`)
    return undefined
  }
  if (ASSET_CONTENT_TYPES[src.split('.').pop()?.toLowerCase() ?? ''] === undefined) {
    problems.push(`${where}: media.src 扩展名不在白名单(${src})`)
    return undefined
  }
  const alt = value.alt
  if (!isNonEmptyString(alt)) {
    problems.push(`${where}: media.alt 必填(无障碍)`)
    return undefined
  }
  const caption = optionalString(value.caption)
  const motion = optionalString(value.motion)
  const sha256 = optionalString(value.sha256)
  const notes = optionalString(value.notes)
  const media: ReleaseMedia = {
    src,
    alt,
    ...(caption === undefined ? {} : { caption }),
    ...(motion === undefined ? {} : { motion }),
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(notes === undefined ? {} : { notes }),
  }
  return media
}

function parseLinks(value: unknown, problems: string[], where: string): readonly ReleaseLink[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    problems.push(`${where}: links 必须是数组`)
    return undefined
  }
  const links: ReleaseLink[] = []
  for (const raw of value) {
    if (!isRecord(raw) || !isNonEmptyString(raw.label) || !isNonEmptyString(raw.action)) {
      problems.push(`${where}: links 每项需要 label/action`)
      continue
    }
    const note = optionalString(raw.note)
    links.push({
      label: raw.label,
      action: raw.action,
      ...(note === undefined ? {} : { note }),
    })
  }
  return links
}

function parseManifest(raw: unknown, versionFallback: string, problems: string[]): ReleaseManifest | undefined {
  // 任何内容错误都整版拒载(而不是「跳过那一页」):内容错是作者笔误,
  // 静默丢弃会让线上少一页而没人发现。门禁/审计看到 issues 即可定位。
  const problemBase = problems.length
  if (!isRecord(raw)) {
    problems.push(`${versionFallback}: release.json 根必须是对象`)
    return undefined
  }
  const version = isNonEmptyString(raw.version) ? raw.version : versionFallback
  if (!RELEASE_VERSION_RE.test(version)) {
    problems.push(`${versionFallback}: version 非法(${version})`)
    return undefined
  }
  const releasedAt = raw.releasedAt
  if (typeof releasedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(releasedAt)) {
    problems.push(`${version}: releasedAt 必须是 YYYY-MM-DD`)
    return undefined
  }
  if (typeof raw.announce !== 'boolean') {
    problems.push(`${version}: announce 必须是布尔`)
    return undefined
  }
  const theme = raw.theme
  const summary = raw.summary
  if (!isNonEmptyString(theme) || !isNonEmptyString(summary)) {
    problems.push(`${version}: theme/summary 必填`)
    return undefined
  }
  const highlightsRaw = raw.highlights
  if (!Array.isArray(highlightsRaw)) {
    problems.push(`${version}: highlights 必须是数组`)
    return undefined
  }
  const highlights: ReleaseHighlight[] = []
  for (const item of highlightsRaw) {
    if (!isRecord(item) || !isNonEmptyString(item.n) || !isNonEmptyString(item.text)) {
      problems.push(`${version}: highlights 每项需要 n/text`)
      continue
    }
    highlights.push({ n: item.n, text: item.text })
  }
  const slidesRaw = raw.slides
  if (!Array.isArray(slidesRaw) || slidesRaw.length === 0) {
    problems.push(`${version}: slides 不能为空`)
    return undefined
  }
  const slides: ReleaseSlide[] = []
  const seenIds = new Set<string>()
  for (const [index, item] of slidesRaw.entries()) {
    const where = `${version} slides[${index}]`
    if (!isRecord(item)) {
      problems.push(`${where}: 必须是对象`)
      continue
    }
    const id = item.id
    const kind = item.kind
    const title = item.title
    if (!isNonEmptyString(id) || seenIds.has(id)) {
      problems.push(`${where}: id 缺失或重复(${String(id)})`)
      continue
    }
    if (kind !== 'cover' && kind !== 'feature' && kind !== 'end') {
      problems.push(`${where}: kind 只能是 cover|feature|end`)
      continue
    }
    if (!isNonEmptyString(title)) {
      problems.push(`${where}: title 必填`)
      continue
    }
    seenIds.add(id)
    const kicker = optionalString(item.kicker)
    const body = optionalString(item.body)
    const footerNote = optionalString(item.footerNote)
    const facts = Array.isArray(item.facts)
      ? item.facts.filter((fact): fact is string => typeof fact === 'string' && fact.trim() !== '')
      : undefined
    const media = parseMedia(item.media, problems, where)
    const links = parseLinks(item.links, problems, where)
    slides.push({
      id,
      kind,
      title,
      ...(kicker === undefined ? {} : { kicker }),
      ...(body === undefined ? {} : { body }),
      ...(facts === undefined ? {} : { facts }),
      ...(media === undefined ? {} : { media }),
      ...(links === undefined ? {} : { links }),
      ...(footerNote === undefined ? {} : { footerNote }),
    })
  }
  if (slides.length === 0) {
    problems.push(`${version}: 没有可渲染的 slides`)
    return undefined
  }
  if (problems.length > problemBase) return undefined
  return { version, releasedAt, announce: raw.announce, theme, summary, highlights, slides }
}

export interface ReleaseCatalogOptions {
  /** `releases/` 目录(默认仓库根/releases;测试可注入临时目录)。 */
  readonly releasesDir?: string
  /** `VERSION` 文件(默认仓库根/VERSION)。 */
  readonly versionFile?: string
}

/**
 * 发布说明目录:启动时一次性读盘并校验,之后只读内存。
 * 新版本随镜像替换,进程生命周期内不需要热更新。
 */
export class ReleaseCatalog {
  private readonly releasesDir: string
  private readonly versionFile: string
  private readonly manifests = new Map<string, ReleaseManifest>()
  private readonly assets = new Map<string, ReadonlyMap<string, { readonly bytes: number; readonly path: string }>>()
  private readonly problems: string[] = []
  private version: string | undefined

  constructor(options: ReleaseCatalogOptions = {}) {
    this.releasesDir = options.releasesDir ?? join(DEFAULT_REPO_ROOT, 'releases')
    this.versionFile = options.versionFile ?? join(DEFAULT_REPO_ROOT, 'VERSION')
    this.reload()
  }

  /** 重新读盘(测试与排查用;正常进程生命周期只读一次)。 */
  reload(): void {
    this.manifests.clear()
    this.assets.clear()
    this.problems.length = 0
    this.version = undefined
    this.readVersion()
    this.readManifests()
  }

  /** 校验期发现的问题(启动时落审计,不阻断)。 */
  get issues(): readonly string[] {
    return this.problems
  }

  /** 仓库根 `VERSION` 内容(缺失/非法 = undefined)。 */
  get currentVersion(): string | undefined {
    return this.version
  }

  manifestOf(version: string): ReleaseManifest | undefined {
    return this.manifests.get(version)
  }

  /** `VERSION` 指向的清单;`announce:false`(rc/热修)时返回 undefined = 不弹。 */
  current(): ReleaseManifest | undefined {
    if (this.version === undefined) return undefined
    const manifest = this.manifests.get(this.version)
    return manifest?.announce === true ? manifest : undefined
  }

  /** 全部版本,新的在前(历史列表与「不补课」判定共用)。 */
  summaries(): readonly ReleaseSummary[] {
    return [...this.manifests.values()]
      .map(({ version, releasedAt, theme, announce }) => ({ version, releasedAt, theme, announce }))
      .sort((a, b) => (a.releasedAt === b.releasedAt
        ? compareVersion(b.version, a.version)
        : a.releasedAt < b.releasedAt ? 1 : -1))
  }

  /** 最新版本号(含 rc)——`announce:false` 时客户端据此显示「本版未公告」。 */
  get latestVersion(): string | undefined {
    return this.summaries()[0]?.version
  }

  /**
   * 资产字节流。只认该版本 assets/ 目录里真实存在、扩展名白名单内的文件;
   * 版本必须已入目录(未加载的版本 = 404,不做任意路径读取)。
   */
  asset(version: string, file: string): ReleaseAsset | undefined {
    if (!RELEASE_VERSION_RE.test(version)) return undefined
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file)) return undefined
    const entry = this.assets.get(version)?.get(file)
    if (entry === undefined) return undefined
    if (entry.bytes > ASSET_MAX_BYTES) return undefined
    const contentType = ASSET_CONTENT_TYPES[file.split('.').pop()?.toLowerCase() ?? '']
    if (contentType === undefined) return undefined
    try {
      return { bytes: readFileSync(entry.path), contentType }
    } catch {
      return undefined
    }
  }

  private readVersion(): void {
    try {
      const raw = readFileSync(this.versionFile, 'utf8').trim()
      if (!RELEASE_VERSION_RE.test(raw)) {
        this.problems.push(`VERSION 内容非法(${JSON.stringify(raw.slice(0, 40))})`)
        return
      }
      this.version = raw
    } catch {
      this.problems.push(`缺少 VERSION 文件(${this.versionFile})`)
    }
  }

  private readManifests(): void {
    let entries: string[]
    try {
      entries = readdirSync(this.releasesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && RELEASE_VERSION_RE.test(entry.name))
        .map(entry => entry.name)
    } catch {
      this.problems.push(`缺少 releases 目录(${this.releasesDir})`)
      return
    }
    for (const version of entries) {
      const dir = join(this.releasesDir, version)
      const manifestPath = join(dir, 'release.json')
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch {
        this.problems.push(`${version}: release.json 缺失或不是合法 JSON`)
        continue
      }
      const manifest = parseManifest(raw, version, this.problems)
      if (manifest === undefined) continue
      if (manifest.version !== version) {
        this.problems.push(`${version}: manifest.version(${manifest.version}) 与目录名不一致`)
        continue
      }
      this.manifests.set(version, manifest)
      this.assets.set(version, this.listAssets(dir))
    }
    if (this.version !== undefined && !this.manifests.has(this.version)) {
      this.problems.push(`${this.version}: 缺少 releases/${this.version}/release.json`)
    }
  }

  /** 目录列表(含真实路径与大小),用于白名单与「孤儿资产」以外的运行时守卫。 */
  private listAssets(versionDir: string): ReadonlyMap<string, { readonly bytes: number; readonly path: string }> {
    const dir = join(versionDir, 'assets')
    const listed = new Map<string, { readonly bytes: number; readonly path: string }>()
    if (!existsSync(dir)) return listed
    let realDir: string
    try {
      realDir = realpathSync(dir)
    } catch {
      return listed
    }
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return listed
    }
    for (const name of names) {
      const path = join(dir, name)
      try {
        const real = realpathSync(path)
        if (real !== realDir && !real.startsWith(realDir.endsWith(sep) ? realDir : `${realDir}${sep}`)) continue
        const stats = statSync(real)
        if (!stats.isFile()) continue
        listed.set(name, { bytes: stats.size, path: real })
      } catch {
        // 悬空软链/权限问题:跳过,资产面按 404 处理。
      }
    }
    return listed
  }
}

/** 语义化版本比较(只用于同日发布的排序,不做完整 semver 语义)。 */
function compareVersion(a: string, b: string): number {
  const parts = (value: string): number[] => (value.split('-')[0] ?? '0').split('.').map(piece => Number.parseInt(piece, 10) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return a === b ? 0 : a < b ? -1 : 1
}
