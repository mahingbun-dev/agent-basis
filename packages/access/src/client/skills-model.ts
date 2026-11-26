/**
 * 技能分区纯逻辑:页签/写权限、上传前置校验、字节与配额文案、frontmatter 预览。
 *
 * 服务端仍是唯一权威(名称 grammar、frontmatter 完整性、zip 安全都在
 * `skills-store.ts`/`skill-zip.ts` 收口);这里只做「别把明显不合法的请求发出去」
 * 与 UI 展示所需的轻量解析,错误文案键与 `skills-section.tsx` 共用。
 */
import type { SkillScopeValue, SkillItemView } from './skills-api.ts'

export type SkillTabId = 'mine' | 'shared' | 'market'
/** 作用域页签(市场页不是作用域,单独渲染)。 */
export type SkillScopeTabId = 'mine' | 'shared'

export interface SkillTab {
  readonly id: SkillTabId
  readonly labelKey: string
}

/** 页签顺序(普通用户也看共享;写权限由 writableFor 决定;市场全员可浏览)。 */
export const SKILL_TABS: readonly SkillTab[] = [
  { id: 'mine', labelKey: 'skills.tab.mine' },
  { id: 'shared', labelKey: 'skills.tab.shared' },
  { id: 'market', labelKey: 'skills.tab.market' },
]

/** 作用域页签判定(市场页签没有 scope)。 */
export function isScopeTab(tab: SkillTabId): tab is SkillScopeTabId {
  return tab === 'mine' || tab === 'shared'
}

/** SKILL.md 客户端上限(与 SKILL_MARKDOWN_MAX 一致)。 */
export const SKILL_MARKDOWN_CLIENT_MAX = 512 * 1024
/** zip 客户端上限(与 SKILL_ZIP_MAX_BYTES 一致)。 */
export const SKILL_ZIP_CLIENT_MAX = 2 * 1024 * 1024

export type SkillSectionRole = 'admin' | 'user'
export type SkillUploadKind = 'md' | 'zip'
export type SkillUploadIssue = 'kind' | 'empty' | 'too-large'
export type SkillMarkdownIssue = 'empty' | 'too-large'

export function scopeOfTab(tab: SkillScopeTabId): SkillScopeValue {
  return tab === 'mine' ? 'personal' : 'shared'
}

export function tabOfScope(scope: SkillScopeValue): SkillTabId {
  return scope === 'personal' ? 'mine' : 'shared'
}

export function itemsOfScope(items: readonly SkillItemView[], scope: SkillScopeValue): readonly SkillItemView[] {
  return items.filter(item => item.scope === scope)
}

/** 个人恒可写;共享仅 admin(服务端仍强制)。 */
export function writableFor(role: SkillSectionRole, scope: SkillScopeValue): boolean {
  return scope === 'personal' || role === 'admin'
}

/** 上传前置校验:扩展名、空文件、客户端大小上限。 */
export function uploadIssue(kind: SkillUploadKind, file: { readonly name: string; readonly size: number }): SkillUploadIssue | undefined {
  const extension = kind === 'md' ? /\.md$/iu : /\.zip$/iu
  if (!extension.test(file.name)) return 'kind'
  if (!Number.isFinite(file.size) || file.size <= 0) return 'empty'
  const max = kind === 'md' ? SKILL_MARKDOWN_CLIENT_MAX : SKILL_ZIP_CLIENT_MAX
  if (file.size > max) return 'too-large'
  return undefined
}

export function uploadIssueMessageKey(kind: SkillUploadKind, issue: SkillUploadIssue): string {
  if (issue === 'kind') return kind === 'md' ? 'skills.onlyMd' : 'skills.onlyZip'
  if (issue === 'empty') return 'skills.fileEmpty'
  return kind === 'md' ? 'skills.mdTooLarge' : 'skills.zipTooLarge'
}

/** 编辑器保存前置校验(字节口径,避免中文按字符数漏判)。 */
export function markdownBytes(markdown: string): number {
  return new TextEncoder().encode(markdown).length
}

export function markdownIssue(markdown: string): SkillMarkdownIssue | undefined {
  if (markdown.trim() === '') return 'empty'
  if (markdownBytes(markdown) > SKILL_MARKDOWN_CLIENT_MAX) return 'too-large'
  return undefined
}

export function markdownIssueMessageKey(issue: SkillMarkdownIssue): string {
  return issue === 'empty' ? 'skills.mdEmpty' : 'skills.mdTooLarge'
}

/** 字节数展示(1024 进制;>0 且最多一位小数)。 */
export function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${scaled(kb)} KB`
  return `${scaled(kb / 1024)} MB`
}

function scaled(value: number): string {
  const fixed = value >= 10 ? value.toFixed(0) : value.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

/** `{used}/{limit}` 双占位替换(quota/limit 两类文案共用)。 */
export function quotaLabel(template: string, used: number, limit: number): string {
  return template.replaceAll('{used}', String(used)).replaceAll('{limit}', String(limit))
}

/** `{count}` 单占位替换。 */
export function countLabel(template: string, count: number): string {
  return template.replaceAll('{count}', String(count))
}

/** 来源徽标文案键;未知来源按「本机/已安装」展示。 */
export function originLabelKey(origin: string): string {
  if (origin === 'form') return 'skills.originForm'
  if (origin === 'upload-md') return 'skills.originUploadMd'
  if (origin === 'upload-zip') return 'skills.originZip'
  if (origin === 'market') return 'skills.originMarket'
  return 'skills.originInstalled'
}

/** 市场安装可选目标:普通用户只装个人;管理员可装共享。 */
export function installTargetsFor(role: SkillSectionRole): readonly SkillScopeValue[] {
  return role === 'admin' ? ['personal', 'shared'] : ['personal']
}

export interface SkillFrontmatterPreview {
  readonly name?: string
  readonly description?: string
  readonly whenToUse?: string
}

/**
 * frontmatter 预览(仅用于编辑器提示,不做完整 YAML)。
 * 与 `skill-format.ts` 同序:去掉 BOM、首行必须 `---`、找结束行、单行 key: value。
 */
export function frontmatterPreview(markdown: string): SkillFrontmatterPreview {
  const text = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown
  const lines = text.split(/\r?\n/u)
  if (lines[0] !== '---') return {}
  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') { closing = index; break }
  }
  if (closing < 0) return {}
  const values = new Map<string, string>()
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('#') || /^\s/u.test(line)) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    values.set(line.slice(0, colon).trim(), scalar(line.slice(colon + 1).trim()))
  }
  const name = firstNonEmpty(values.get('name'))
  const description = firstNonEmpty(values.get('description'))
  const whenToUse = firstNonEmpty(values.get('whenToUse'), values.get('when-to-use'))
  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(whenToUse === undefined ? {} : { whenToUse }),
  }
}

function scalar(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1)
      .replaceAll('\\"', '"')
      .replaceAll('\\n', '\n')
      .replaceAll('\\\\', '\\')
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replaceAll("''", "'")
  }
  const comment = raw.indexOf(' #')
  return (comment >= 0 ? raw.slice(0, comment) : raw).trim()
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/** 新建技能模板(与 `skill-format.ts` 的 newSkillTemplate 同形,不跨半边引服务端模块)。 */
export function newSkillTemplate(): string {
  return [
    '---',
    'name: my-skill',
    'description: 一句话说明何时使用这个技能',
    '---',
    '',
    '# my-skill',
    '',
    '在这里写这个技能的完整指令。',
    '',
  ].join('\n')
}

/** Uint8Array → base64(zip 上传;分块避免 2MB 展开成大参数表)。 */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const slice = bytes.subarray(offset, Math.min(offset + chunk, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}
