/**
 * prompt-scan(T2.5,计划书 §5「packctl 门禁」/§6 T2.5):提示词登记铁律的静态检查器。
 *
 * 「全产品提示词唯一管理面」的反面强制:涉及提示词工程而未在注册表登记的
 * 插件/包被 CI 拦截(计划书成功标准 4)。登记真值 =
 * @eterna/prompt-studio/registry 的 PROMPT_REGISTRY_ENTRIES(T1.3 三层
 * 存量登记,与 docs/dev/ps-v2-registry-ledger.md 双向锁住)——本扫描直接 import
 * 该表做匹配判定,不维护第二份清单,杜绝扫描器与注册表漂移。
 *
 * 三个扫描面(计划书 §5「做」第 5 条原文:扫描 cordis.patch.yml 的 prompt 型
 * config 键 + ctx.systemPrompt.section 使用 + packs persona):
 *   P1 patch 层 prompt 型 config 键 —— profiles/ packs/ packages/ market/ 下全部
 *      cordis.patch.yml(成功标准 4 的「插件/包」也覆盖:packages 自有 bundle patch):
 *      personaPrefix(system-prompt 专属键,任意上下文)、persona 插件的 prefix、
 *      plan-mode 插件的 section(按最近包围列表项/行的 id 判定归属,防止其它插件
 *      的同名 config 键误报)。登记判定 = 注册表条目 yaml 定位
 *      (file+rowId+pluginPath+configKey)精确匹配。
 *   P2 packs persona —— packs 下各领域包根的 persona.md(06 号 SOP S1 分诊:
 *      角色/语气/全局硬约束,唯一允许进 prompt 的三类)。登记判定 = 任一条目
 *      anchors 引用该文件。
 *   P3 运行时 section 使用 —— packages/* 源码(.ts/.mjs/.js,剥注释,tests/ 豁免,
 *      tenant-scan 同款遍历纪律):`systemPrompt.section(`(直接调用,memory 形态)与
 *      `systemPrompt: true`(inject 声明,glue 形态——注册表 runtime.glue 条目的
 *      登记锚点即此行)。登记判定 = 任一条目 anchors 引用该源文件。
 *
 * 白名单与豁免标注(计划书 §7 风险对策「扫描规则带白名单与豁免标注」):
 * PROMPT_SCAN_WHITELIST 按路径前缀豁免,每条必须带 reason(豁免标注);缺 reason
 * 的条目本身产出 warning(prompt/whitelist-without-reason)——豁免决定必须可审查,
 * 不允许无声放行。
 *
 * 已知边界(如实,不造全覆盖假象):行级扫描对块标量正文里恰好像 `key: value` 的
 * 行会误报(走白名单豁免);alias 形态(`const sp = ctx.systemPrompt; sp.section()`)
 * 静态不可见;运行时 home(.eterna-home*,gitignored)不在扫描面。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PROMPT_REGISTRY_ENTRIES } from '@eterna/prompt-studio/registry'
import type { PromptRegistryEntry } from '@eterna/prompt-studio/registry'
import { error, warning, type Finding } from './types.ts'
import { stripCommentsLineByLine } from './util.ts'

/** 白名单豁免条目:路径前缀 + 豁免标注(reason 必填,缺失即扫描警告)。 */
export interface PromptWhitelistEntry {
  /** 仓库根相对 POSIX 路径前缀(目录以 / 结尾;也接受精确文件路径)。 */
  readonly path: string
  /** 豁免标注:为什么这块可以不登记——供 PR 审查,不允许空。 */
  readonly reason: string
}

/**
 * 仓内既知豁免(2026-11-11 实测盘点):
 * - packages/prompt-studio:提示词注册表与工作室管理面本体——条目 anchors 内含
 *   `ctx.systemPrompt.section(section)`/`systemPrompt: true` 样例字面量,管理面
 *   非注入方(T1.3 登记制);
 * - market/pack-bundle:市场自包含构建产物(scripts/build-market.mjs 生成,README
 *   明示勿手改),镜像 packs/event-planning——提示词真值由源包条目登记。
 */
export const PROMPT_SCAN_WHITELIST: readonly PromptWhitelistEntry[] = [
  {
    path: 'packages/prompt-studio/',
    reason: '提示词注册表与工作室管理面本体:条目 anchors 含注入调用样例字面量,管理面非注入方(T1.3 登记制)',
  },
  {
    path: 'market/pack-bundle/',
    reason: '市场自包含构建产物(scripts/build-market.mjs 生成,勿手改):镜像 packs/event-planning,提示词真值由源包条目登记',
  },
]

/** promptScan 选项:登记真值与白名单均可注入(测试用;缺省=仓内既知事实)。 */
export interface PromptScanOptions {
  /** 登记真值(缺省 = prompt-studio 注册表 PROMPT_REGISTRY_ENTRIES)。 */
  readonly registry?: readonly PromptRegistryEntry[]
  /** 白名单(缺省 = PROMPT_SCAN_WHITELIST)。 */
  readonly whitelist?: readonly PromptWhitelistEntry[]
}

/** patch 层扫描根(profiles=patch 层本体;packages=插件自有 bundle patch;market=市场构建)。 */
const PATCH_SCAN_ROOTS: readonly string[] = ['profiles', 'packs', 'packages', 'market']

/** 任意上下文都算提示词面的专属键(system-prompt 的 personaPrefix)。 */
const CONTEXT_FREE_PROMPT_KEYS: ReadonlySet<string> = new Set(['personaPrefix'])

/** 需归属上下文(id 锚)判定的 prompt 型 config 键:键 → 最近包围项/行的 id。 */
const KEY_OWNING_CONTEXT: Readonly<Record<string, string>> = {
  prefix: 'persona',
  section: 'plan-mode',
}

/** P3 运行时使用的两条命中模式(直接调用 / inject 声明)。 */
const SECTION_CALL_RE = /systemPrompt\.section\(/
const SECTION_INJECT_RE = /systemPrompt:\s*true/

/** patch 文件里检测到的一次 prompt 型 config 键使用(结构定位四元组 + 行号)。 */
interface PatchKeyUsage {
  readonly file: string
  readonly rowId: string
  readonly pluginPath: readonly string[]
  readonly configKey: string
  readonly line: number
}

/**
 * 通用目录遍历:root/rel 起递归(跳过 node_modules/lib/点前缀目录),收集文件名
 * 满足 accept 的仓库根相对 POSIX 路径。目录缺失/不可读静默返回(tenant-scan 同款
 * 容错:临时仓库常只有部分根目录)。
 */
function walkFiles(root: string, rel: string, accept: (name: string) => boolean, out: string[]): void {
  let entries: readonly string[]
  try {
    entries = readdirSync(join(root, rel))
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'lib' || entry.startsWith('.')) continue
    const relPath = rel === '' ? entry : `${rel}/${entry}`
    let isDir = false
    try {
      isDir = statSync(join(root, relPath)).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkFiles(root, relPath, accept, out)
      continue
    }
    if (accept(entry)) out.push(relPath)
  }
}

/**
 * 枚举 patch 文件里的 prompt 型 config 键使用(行级结构走查,语义对齐注册表
 * locateYamlConfigKey 的定位口径):
 * - 顶层行 = 列 0 的 `- id: <rowId>`(span 到下一顶层行,`- insert:` 块归入前一行的
 *   span,与 findTopLevelRow 一致);
 * - 嵌套列表项 `- id: <id>`(缩进 > 0)入栈构成 pluginPath 链;键行归属 = 栈内缩进
 *   严格小于键缩进的最近项(同缩进算列表项自身的映射键,如 `- id: persona` 的
 *   `config:`),栈空则归属顶层行本身(packs 覆写形态:system-prompt 行直接带
 *   personaPrefix);
 * - prompt 型判定:CONTEXT_FREE_PROMPT_KEYS 命中,或 KEY_OWNING_CONTEXT 的归属
 *   上下文(项 id 或行 id)与键配对。
 */
function enumeratePatchKeyUsages(file: string, text: string): readonly PatchKeyUsage[] {
  const usages: PatchKeyUsage[] = []
  const lines = text.split('\n')
  let rowId: string | undefined
  let stack: { id: string; indent: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const itemMatch = /^(\s*)- id: (\S+)\s*$/.exec(line)
    if (itemMatch !== null) {
      const indent = (itemMatch[1] ?? '').length
      const id = itemMatch[2] ?? ''
      if (indent === 0) {
        rowId = id
        stack = []
        continue
      }
      if (rowId === undefined) continue
      while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) stack.pop()
      stack.push({ id, indent })
      continue
    }
    if (rowId === undefined) continue
    const keyMatch = /^(\s*)([\w.-]+): /.exec(line)
    if (keyMatch === null) continue
    const indent = (keyMatch[1] ?? '').length
    const key = keyMatch[2] ?? ''
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) > indent) stack.pop()
    const contextId = stack.length > 0 ? stack[stack.length - 1]?.id ?? rowId : rowId
    const isPromptKey = CONTEXT_FREE_PROMPT_KEYS.has(key) || KEY_OWNING_CONTEXT[key] === contextId
    if (!isPromptKey) continue
    usages.push({ file, rowId, pluginPath: stack.map(item => item.id), configKey: key, line: i + 1 })
  }
  return usages
}

/** P1 登记判定:注册表条目 yaml 定位与使用四元组精确匹配。 */
function coveringEntryForUsage(
  usage: PatchKeyUsage,
  registry: readonly PromptRegistryEntry[],
): PromptRegistryEntry | undefined {
  const pluginPath = usage.pluginPath.join('/')
  return registry.find(entry => entry.yaml !== undefined
    && entry.yaml.file === usage.file
    && entry.yaml.rowId === usage.rowId
    && (entry.yaml.pluginPath ?? []).join('/') === pluginPath
    && entry.yaml.configKey === usage.configKey)
}

/** P2/P3 登记判定:任一条目的行锚点引用该文件(锚点行号对账归 registry.test.ts,此处只认文件归属)。 */
function entryAnchoringFile(file: string, registry: readonly PromptRegistryEntry[]): PromptRegistryEntry | undefined {
  return registry.find(entry => entry.anchors.some(anchor => anchor.file === file))
}

/**
 * 对仓库做提示词登记铁律扫描;返回 findings(行号 1 基,tenant-scan 同款形态)。
 * 退出面由 CLI 决定:任何 finding(含缺豁免标注 warning)→ 退出码 1。
 */
export function promptScan(repoRoot: string, options: PromptScanOptions = {}): readonly Finding[] {
  const registry = options.registry ?? PROMPT_REGISTRY_ENTRIES
  const whitelist = options.whitelist ?? PROMPT_SCAN_WHITELIST
  const findings: Finding[] = []
  const whitelisted = (path: string): boolean =>
    whitelist.some(entry => path === entry.path || path.startsWith(entry.path))

  // 豁免标注自检:白名单条目缺 reason 本身就是 finding(强制可审查,不允许无声放行)。
  for (const entry of whitelist) {
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      findings.push(warning('prompt/whitelist-without-reason', entry.path,
        '白名单豁免缺标注(reason)——每条豁免必须写明原因供 PR 审查(计划书 §7 风险对策:扫描规则带白名单与豁免标注)'))
    }
  }

  // P1:patch 层 prompt 型 config 键(profiles/packs/packages/market 的 cordis.patch.yml)。
  const patchFiles: string[] = []
  for (const root of PATCH_SCAN_ROOTS) {
    walkFiles(repoRoot, root, name => name === 'cordis.patch.yml', patchFiles)
  }
  for (const file of patchFiles) {
    if (whitelisted(file)) continue
    let text: string
    try {
      text = readFileSync(join(repoRoot, file), 'utf8')
    } catch {
      continue
    }
    for (const usage of enumeratePatchKeyUsages(file, text)) {
      if (coveringEntryForUsage(usage, registry) !== undefined) continue
      const located = usage.pluginPath.length > 0 ? `, path=${usage.pluginPath.join('/')}` : ''
      findings.push(error('prompt/unregistered-prompt-key', `${file}:${usage.line}`,
        `patch 层 prompt 型 config 键 ${usage.configKey}(row=${usage.rowId}${located})未在提示词注册表登记——在 packages/prompt-studio/src/registry.ts 增加条目并对账 docs/dev/ps-v2-registry-ledger.md,或确认属豁免面写明白名单标注后再提交`))
    }
  }

  // P2:packs persona(packs/*/persona.md,06 号 SOP S1 分诊唯一进 prompt 的三类内容)。
  const packsDir = join(repoRoot, 'packs')
  if (existsSync(packsDir)) {
    for (const pack of readdirSync(packsDir)) {
      const rel = `packs/${pack}/persona.md`
      if (!existsSync(join(repoRoot, rel)) || whitelisted(rel)) continue
      if (entryAnchoringFile(rel, registry) !== undefined) continue
      findings.push(error('prompt/unregistered-pack-persona', `${rel}:1`,
        'packs persona(persona.md)未在提示词注册表登记——领域层 persona 全文必须登记(对账真值 docs/dev/ps-v2-registry-ledger.md)'))
    }
  }

  // P3:运行时 section 使用(packages/* 源码,剥注释,tests/ 豁免;每文件至多一条指路)。
  const packagesDir = join(repoRoot, 'packages')
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      if (!statSync(join(packagesDir, pkg), { throwIfNoEntry: false })?.isDirectory()) continue
      const sources: string[] = []
      walkFiles(packagesDir, pkg, name => /\.(ts|mjs|js)$/.test(name), sources)
      for (const walked of sources) {
        const rel = `packages/${walked}`
        if (rel.includes('/tests/') || whitelisted(rel)) continue
        let text: string
        try {
          text = readFileSync(join(packagesDir, walked), 'utf8')
        } catch {
          continue
        }
        for (const line of stripCommentsLineByLine(text)) {
          if (!SECTION_CALL_RE.test(line.text) && !SECTION_INJECT_RE.test(line.text)) continue
          if (entryAnchoringFile(rel, registry) === undefined) {
            findings.push(error('prompt/unregistered-section-usage', `${rel}:${line.line}`,
              '源码使用 ctx.systemPrompt.section / systemPrompt 注入声明但未在提示词注册表登记运行时注入型条目——登记后再提交(T2.6 自管改造:section 文本从注册表读)'))
          }
          break
        }
      }
    }
  }

  return findings
}
