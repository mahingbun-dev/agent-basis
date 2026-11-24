#!/usr/bin/env node
/**
 * Real-boot verification for the Eterna enterprise Web 档 (profiles/eterna-web).
 *
 * Boots the actual composition — rc.5 默认六 bundle（base + web-app + chat-import +
 * session-search + plugin-market + terminal）+ docker/profile/cordis.patch.yml.template
 * （entrypoint 逐字落卷的生产渲染源；行序/覆写按 rc.5 行集重放）— with the repo-local
 * dsh CLI (no model calls, no credentials, OS-assigned port via --port 0), then asserts
 * against the LIVE pluginInventory/list Remote (read-only projection of the settled
 * Loader tree) that:
 *   - every cut row is absent or disabled, in the host tree AND in every agent
 *     preset composition (a preset re-enabling a cut row is a failure);
 *   - every kept host row is present, enabled, and ACTIVE;
 *   - every kept preset row is present, enabled, and ACTIVE in the default
 *     `standard` preset;
 *   - no entry sits in the `failed` phase (catches broken injection chains that
 *     a future upstream refresh could introduce);
 *   - T1.2 生产挂载（ps-v2）：eterna-prompt-studio 行 present+enabled+active，
 *     启动日志无 skipping/incompatible，宿主 index.html 的 __DSH_BOOT__ 花名册
 *     含 @eterna/prompt-studio/client.js 且 combo 含本包 factory 注册。
 *
 * dump-config is deliberately NOT used: it only proves patch text, not row
 * activation (2026-11-04 E2E 教训). The readiness signal is the `dsh web: <url>`
 * stdout line, which the web-runtime row prints only after the Loader settled
 * and the required-entry startup audit passed (dsh-web-app src/index.ts:244-254).
 *
 * Environment:
 *   ETERNA_PROFILE_HOME — DSH home to materialize the profile in
 *                        (default: <repo>/.eterna-home)
 *
 * Exit 0 = all assertions passed; exit 1 = boot or assertion failure.
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const sourcePatch = join(repoRoot, 'docker', 'profile', 'cordis.patch.yml.template')
const home = resolve(process.env.ETERNA_PROFILE_HOME ?? join(repoRoot, '.eterna-home'))
const profileName = 'eterna-web'
const profileDir = join(home, 'profiles', profileName)

const BOOT_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 10_000

/**
 * T11 出口口径（54 §4.4/§4.11、51 BOOT-004..007/012）：
 *  - host entries 是本形态 settle 后的 Loader 树规模（rc.5 基线 229；行漂移即红）；
 *  - 模板形态 43 blocks = 3 insert + 40 override（T10 交付数；/clear 组内嵌套行不占），override 必须
 *    全部命中活体树，0 unknown；
 *  - 槽位漂移：本仓 client 注册的 slot 必须命中活宿主 slot catalog，且源码声明
 *    面 == 浏览器实收 bundle 的注册面（无缺失/无多出）；
 *  - stderr 不得出现 app-boot 的 `disabling profile plugin`（兼容性冲突静默裁行）。
 */
// 2026-11-23 /clear:command-clear 为组内嵌套行(顶层 `- ` 行口径不变),常量不动。
// 2026-11-24 54 号:参谋面板 +2 行(eterna-adviser 挂载行 + eterna-adviser-preset)。
const EXPECTED_HOST_ENTRIES = 231
const EXPECTED_TEMPLATE_BLOCKS = 43
const EXPECTED_TEMPLATE_INSERTS = 3
const EXPECTED_TEMPLATE_OVERRIDES = 40
/** T36 固定产品客户端包（super 全挂、web 少 workbench：按本形态实际挂载取子集）。 */
const T36_PRODUCT_CLIENT_PACKAGES = [
  'access', 'attachments', 'brand', 'compaction', 'llm-doctor',
  'memory', 'panel', 'prompt-studio', 'usage-stats', 'workbench',
]
/** 可选：设为目录时由本脚本落脱敏证据（inventory/boot 日志/槽位报告）。 */
const EVIDENCE_DIR = process.env.ETERNA_EVIDENCE_DIR

/** Rows the enterprise Web 档 cuts (plans §11.2/§11.3/§11.8; credentials 见 docs 偏差说明). */
const CUT_ROWS = [
  // 遥测两处
  'otel', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics',
  // 凭据库 + 账号体系（credentials 保留：connection 必需行硬依赖，见 docs）
  'authorization', 'deepseek-account', 'llm-deepseek', 'llm-deepseek-account',
  // account-controller 行 rc.5 已整体删除（47 §2.2）；保留在清单里只会让 absent 假绿。
  'ui-settings-account',
  // 50 §3.2 第 3 条「禁」：账号通知面与 Desktop 专属依赖解析（模板显式 disabled 钉死）。
  'ui-account-notifications', 'workspace-dependencies',
  // ptc 家族修订（2026-11-09）：创造模式（preset-cordis）回加后 ptc-runtime/
  // workflow-ptc/tool-workflow 三行宿主回加（workflow-ptc 硬依赖 ptcRuntime
  // 服务）；仅 tool-executor-ptc 维持裁切。标准会话经 preset-standard 内
  // disabled 不可见。另本就 disabled 的两行
  'tool-executor-ptc', 'fs-observation-policy', 'tool-plugin-manager', 'ui-workflow-run',
  // 场景裁切（shortcuts 不在此列：client 服务根，2026-11-09 浏览器 E2E 教训——
  // 裁掉即 26 个 client-ui 插件 web boot 全家 pending，宿主侧断言照绿）
  // office-to-pdf 行 rc.5 已删除（47 §2.2），从裁切清单移除。
  'open-in-app', 'ui-open-in-app', 'ui-shortcuts',
  'ui-brand-official', 'ui-message-feedback',
  // Session Log 上传（2026-11-09 用户裁定：通用设置去掉该开关，上传能力一并裁——数据不出内网）
  'session-log-deepseek', 'ui-settings-session-log',
]

/** Kept rows that live in the HOST plane: present + enabled + active. */
const HOST_KEPT_ROWS = [
  // 基础能力骨架
  'llm', 'llm-retry', 'session', 'session-persistence-jsonl', 'session-checkpoint-policy',
  'spill-local', 'spill-policy', 'image-offload', 'agent', 'agent-loop', 'agent-default-model',
  'system-prompt', 'tools', 'tool-executor-native', 'fs-sandbox', 'sandbox', 'sandbox-policy',
  'bash-sandbox', 'approval', 'permission', 'shell-env', 'subprocess', 'jobs', 'timeout-policy',
  'repeat-tool-reminder', 'token-meter', 'commands', 'command-feedback', 'user-questions',
  'working-directory', 'tool-working-directory', 'session-projection', 'session-projection-cache',
  'storage', 'storage-json', 'storage-domain', 'attachment-local', 'mcp-resources',
  // 回加家族（host 半）
  'goal', 'goal-round-driver', 'subagent', 'agent-team', 'tool-agent-team',
  'subagent-spawn-in-process', 'subagent-fork-in-process',
  'schedule', 'web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http',
  // 创造模式宿主行（2026-11-09 回加：workflow-ptc 硬依赖 ptcRuntime）
  'ptc-runtime', 'workflow-ptc', 'tool-workflow',
  // skill / title / query
  'skill', 'session-title', 'session-title-llm', 'session-query-sqlite',
  // Web 网关与传输
  'typert', 'typert-loader', 'typert-gateway', 'remote-access', 'timer',
  'webserver', 'web-runtime', 'web-startup', 'connection', 'modules', 'plugin-inventory',
  // jobs/报告异步化（图纸⑦）
  'job-controller', 'ui-jobs', 'deliverable-file-references',
  // rc.5 新增宿主行（47 §2.2 行漂移）：MCP 系统层 manager、Office 行集、
  // 文件动作/上下文菜单/Agent Team UI、terminal bundle 组（组行+三内行）。
  'mcp-manager', 'office-kit', 'skill-office',
  'ui-file-actions', 'ui-context-menu', 'ui-agent-team',
  // terminal bundle 的 cordis:group 行本身不进 inventory（2026-11-20 真 boot 实测：
  // 229 entries 内是三个子行），组在场由子行全 active + 侧栏 terminal-controller 间接证明。
  'optional-terminal-registry', 'optional-terminal-panel', 'optional-tool-terminal',
  // 企业挂载面（2026-11-19 base 清单对同步补断言，A6 契约 ②）：治理三行 + memory/
  // knowledge/brand/access/llm-doctor/usage-stats/panel + directory-picker-host
  // ——与 BASE_MOUNT_PACKAGES 及挂载行一一对应防回归（super 母本 2026-11-17 端到端
  // 教训：symlink 缺链时行静默不激活且原断言面不覆盖，/login 404、/access/api 无守卫）。
  'directory-picker-host',
  'eterna-governance', 'eterna-audit', 'eterna-egress', 'eterna-memory', 'eterna-knowledge',
  'eterna-llm-doctor', 'eterna-brand', 'eterna-access', 'eterna-usage-stats', 'eterna-panel',
  // UI：审批/上传/设置/交付
  'ui-chat', 'ui-conversation', 'ui-approval', 'ui-permission', 'ui-user-questions',
  'ui-attachment', 'ui-tool', 'ui-renderer', 'settings-controller', 'ui-settings',
  'ui-settings-models', 'ui-deliverables', 'ui-skill', 'session-log-download',
  'session-controller', 'session-stats', 'session-turn-outline',
  // 回加 UI（§11.8）
  'ui-schedule', 'ui-goal', 'ui-plan', 'ui-subagent', 'subagent-model-selection-settings',
  'ui-sidebar-browser', 'ui-sidebar-terminal', 'terminal-controller',
  // workspace 与预设
  'workspace', 'workspace-controller', 'workspace-files', 'file-upload', 'file-reference-local',
  'locale', 'ui-theme', 'agent-preset-registry',
  // client 服务根（§11.3 修订：浏览器 E2E 实测 26 插件等待链的根，必留）
  'shortcuts',
  // 计划书偏差说明的实证行：必须保持启用
  'credentials',
  // 提示词工作室（T1.2 生产挂载，insert 行 + profile node_modules symlink）
  'eterna-prompt-studio',
  // 附件入口（2026-11-12 生产挂载，输入框工具行「附件」按钮，客户端双面包）
  'eterna-attachments',
  // 参谋面板（2026-11-24 54 号 P9 生产挂载：右栏「参谋」tab + 三入口 + 回写条；
  // @eterna/adviser 双面包，行在 insert 块末）
  'eterna-adviser',
]

/** Kept rows that live behind agent presets: present + enabled + active in `standard`. */
const PRESET_KEPT_ROWS = [
  'tool-bash', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-schedule',
  'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'plan-mode',
  'compaction-basic', 'command-compact', 'tool-result-pruner',
  'stale-tool-result-pruner',
  'tool-subagent-control', 'tool-subagent', 'tool-subagent-fork',
  'tool-todo', 'tool-web', 'agent-instructions', 'tool-ask-user',
  // rc.5 B15：两预设均补 tool-office 行（整份重述不补即静默丢 rc.5 默认，H5）。
  'tool-office',
]

// ---------------------------------------------------------------------------
// 1. Materialize the profile under the DSH home.

if (!existsSync(dshBin)) {
  console.error(`verify-eterna-web: dsh CLI not found at ${dshBin}; run pnpm install first`)
  process.exit(1)
}
if (!existsSync(sourcePatch)) {
  console.error(`verify-eterna-web: missing ${sourcePatch}`)
  process.exit(1)
}
const homePatch = join(home, 'cordis.patch.yml')
if (existsSync(homePatch)) {
  console.error(`verify-eterna-web: ${homePatch} exists; a home-level user patch would compose over the profile layer and break determinism — remove it or point ETERNA_PROFILE_HOME at a clean home`)
  process.exit(1)
}

rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
// 创造模式（preset-cordis）硬依赖：skill-filesystem 的 customSkillDirs 表达式
// 以 createRequire(baseUrl) 解析 **@eterna/creation-skills**（baseUrl=profile 目录；
// rc.5 H5 起由 dsh-agent-preset/skills 改指品牌化 fork = packages/brand，entrypoint
// 第 3 步建同名别名）——缺链即 skill-filesystem failed（MODULE_NOT_FOUND）。
const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
const profileNodeModules = join(profileDir, 'node_modules', '@deepseek-ai')
mkdirSync(profileNodeModules, { recursive: true })
// companion 浏览器执行面（E1）：dsh-mcp-client 插件（mcp-browser 条目的 name 引用）
const mcpClientCandidates = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).filter((dir) => dir.startsWith('@deepseek-ai+dsh-mcp-client@0.2.2-rc.5'))
  : []
if (mcpClientCandidates.length === 0) {
  console.error('verify-eterna-web: @deepseek-ai/dsh-mcp-client@0.2.2-rc.5 未安装——mcp-browser 条目无法解析')
  process.exit(1)
}
const mcpClientDir = join(pnpmDir, mcpClientCandidates[0], 'node_modules', '@deepseek-ai', 'dsh-mcp-client')
symlinkSync(mcpClientDir, join(profileNodeModules, 'dsh-mcp-client'), 'dir')
// 提示词工作室（T1.2 生产挂载）：insert 行 name 解析 '@eterna/prompt-studio' 经
// profile node_modules（Loader + client-modules 两个消费方都只按 node_modules 解析，
// 不读 profile 依赖表——t7-smoke.mjs ensurePluginInstalled 同款 symlink 终态；
// realpath 落 repo 源树，运行时依赖走 repo 工作区）。
const promptStudioPkg = join(repoRoot, 'packages', 'prompt-studio')
if (!existsSync(join(promptStudioPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-web: packages/prompt-studio/lib/client.js 缺失——先跑 pnpm --filter @eterna/prompt-studio run verify（build:client）')
  process.exit(1)
}
mkdirSync(join(profileDir, 'node_modules', '@eterna'), { recursive: true })
symlinkSync(join(repoRoot, 'packages', 'brand'), join(profileDir, 'node_modules', '@eterna', 'creation-skills'), 'dir')
symlinkSync(promptStudioPkg, join(profileDir, 'node_modules', '@eterna', 'prompt-studio'), 'dir')
// 附件入口（2026-11-12 生产挂载）：insert 行 name 解析 '@eterna/attachments'
// 同样只经 profile node_modules；客户端双面包需宿主 Loader 条目 + lib/client.js。
const attachmentsPkg = join(repoRoot, 'packages', 'attachments')
if (!existsSync(join(attachmentsPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-web: packages/attachments/lib/client.js 缺失——先跑 pnpm --filter @eterna/attachments run verify（build:client）')
  process.exit(1)
}
symlinkSync(attachmentsPkg, join(profileDir, 'node_modules', '@eterna', 'attachments'), 'dir')
// 上下文压缩家族（2026-11-12 fork 本地化）：compaction group 三行 name 解析
// '@eterna/compaction/*-plugin' 同样只经 profile node_modules。缺此行时三行解析失败，
// 整组 standard 预设行静默不激活（fiberPhase=null）——与 entrypoint 记载的
// @deepseek-ai 版本错配同一种「静默 disable」表现。
symlinkSync(join(repoRoot, 'packages', 'compaction'), join(profileDir, 'node_modules', '@eterna', 'compaction'), 'dir')
// 记忆插件载具（M-M3 T12 前端四件，2026-11-14）：eterna-memory-client /
// eterna-memory-admin 两行 name 解析 '@eterna/memory(+/admin-plugin)' 同样只经
// profile node_modules（宿主 Loader + SRC 端点两面）；客户端双面包需 lib/client.js。
const memoryPkg = join(repoRoot, 'packages', 'memory')
if (!existsSync(join(memoryPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-web: packages/memory/lib/client.js 缺失——先跑 pnpm --filter @eterna/memory run verify（build:client）')
  process.exit(1)
}
symlinkSync(memoryPkg, join(profileDir, 'node_modules', '@eterna', 'memory'), 'dir')
// base 模板 insert 面其余 @eterna 行的 symlink（2026-11-19 base 清单对同步，A6 契约 ①②）：
// 治理三行 name='@eterna/glue/*-plugin'、记忆 = glue memory-plugin；知识底座 =
// @eterna/knowledge-admin 单宿主（四工具 + 知识库工作台 + 账号面）。access/brand/
// llm-doctor/usage-stats/panel 各行同样只经 profile node_modules 解析——缺链时 Loader
// 静默跳过（行不激活、boot log 照洁），镜像侧由 entrypoint 第 3 步全量清单承担；
// 本地 verify 与镜像同口径补齐（verify-eterna-super.mjs BASE_MOUNT_PACKAGES 同源）。
const knowledgeAdminPkg = join(repoRoot, 'packages', 'knowledge-admin')
if (!existsSync(join(knowledgeAdminPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-web: packages/knowledge-admin/lib/client.js 缺失——先跑 pnpm --filter @eterna/knowledge-admin run build:client')
  process.exit(1)
}
const BASE_MOUNT_PACKAGES = ['glue', 'llm-doctor', 'brand', 'access', 'usage-stats', 'panel', 'knowledge-admin', 'adviser']
for (const pkg of BASE_MOUNT_PACKAGES) {
  symlinkSync(join(repoRoot, 'packages', pkg), join(profileDir, 'node_modules', '@eterna', pkg), 'dir')
}
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: `dsh-profile-${profileName}`,
  private: true,
  dsh: { profile: { bundles: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-deepseek-chat-import',
    '@deepseek-ai/dsh-experimental-session-search',
    '@deepseek-ai/dsh-experimental-plugin-market-bundle',
    '@deepseek-ai/dsh-experimental-terminal-bundle',
  ] } },
}, null, 2)}\n`)
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
copyFileSync(sourcePatch, join(profileDir, 'cordis.patch.yml'))
const copied = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
if (copied !== readFileSync(sourcePatch, 'utf8')) {
  console.error('verify-eterna-web: profile patch copy drifted from the source file')
  process.exit(1)
}
// 模板形态静态口径（T10）：顶层 patch block = insert 块 + override 行。
const templateStats = summarizeTemplate(copied)

// ---------------------------------------------------------------------------
// 2. Boot.

const child = spawn(process.execPath, [dshBin, '--profile', profileName, '--no-open', '--port', '0'], {
  cwd: repoRoot,
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const output = []
const collect = (stream, sink) => {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    sink(chunk)
    output.push(chunk)
  })
}
collect(child.stdout, () => {})
collect(child.stderr, () => {})
// T11 的 `disabling profile plugin` 是 stderr 判据：与合并 output 分开留档。
let stdoutText = ''
let stderrText = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => { stdoutText += chunk })
child.stderr.on('data', (chunk) => { stderrText += chunk })

let urlLine
try {
  urlLine = await new Promise((resolveLine, rejectLine) => {
    const timer = setTimeout(() => rejectLine(new Error(`boot did not print the readiness line within ${BOOT_TIMEOUT_MS}ms`)), BOOT_TIMEOUT_MS)
    const check = () => {
      const match = output.join('').match(/^dsh web: (\S+)$/m)
      if (match) {
        clearTimeout(timer)
        resolveLine(match[1])
      }
    }
    child.stdout.on('data', check)
    child.stderr.on('data', check)
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectLine(new Error(`dsh exited early with code ${code}`))
    })
    check()
  })
} catch (error) {
  await stop(child)
  console.error(`verify-eterna-web: boot failed: ${error.message}`)
  console.error('--- dsh output ---')
  console.error(output.join(''))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Probe the live inventory.

const result = await probe(urlLine)
// T1.2 生产挂载的浏览器半边证据：宿主 index.html 的 __DSH_BOOT__ 花名册须含
// 本包 client.js（须在 stop 前对活宿主取证；三步换票照抄 t7-ui-check.mjs:96-110）。
const roster = await probeRoster(urlLine)
await stop(child)

if (!result.ok) {
  console.error(`verify-eterna-web: pluginInventory/list failed: ${JSON.stringify(result.error)}`)
  process.exit(1)
}
const snapshot = result.value
const hostByEntry = new Map(snapshot.entries.map((entry) => [entry.entryId.replace(/^include:/, ''), entry]))
const presetByName = new Map((snapshot.agentPresets ?? []).map((preset) => [preset.id, preset]))

const failures = []
const pass = (label, condition, detail) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// 3-pre. T1.2 生产挂载：启动日志洁净（无 skipping/incompatible——装载被跳过或
// 版本不兼容时宿主只打日志不进 failed 相位，t7-ui-check.mjs:127 同款口径）。
pass('boot log clean (no skipping/incompatible)', !/skipping|incompatible/i.test(output.join('')),
  'boot + probe 期间 stdout/stderr 无装载跳过或版本不兼容记录')

// 3a. No failed rows: a failed row means an injection chain broke (e.g. a cut
// row still has a hard consumer) — fatal even when the audit only warns.
const failed = snapshot.entries.filter((entry) => entry.fiberPhase === 'failed')
pass('no failed entries', failed.length === 0,
  failed.map((entry) => `${entry.entryId}: ${entry.diagnostic ?? 'failed'}`).join(' | ') || `${snapshot.entries.length} entries settled`)

// 3b. Cut rows: absent or disabled in the host tree, and not enabled in any preset.
const cutViolations = []
for (const id of CUT_ROWS) {
  const host = hostByEntry.get(id)
  if (host !== undefined && host.enabled) cutViolations.push(`${id}: host entry enabled`)
  for (const preset of presetByName.values()) {
    const row = preset.rows.find((candidate) => candidate.entryId === id)
    if (row !== undefined && row.enabled) cutViolations.push(`${id}: enabled in preset ${preset.id}`)
  }
}
pass(`all ${CUT_ROWS.length} cut rows inactive`, cutViolations.length === 0, cutViolations.join('; ') || 'absent or disabled everywhere')

// 3c. Host kept rows: present, enabled, active.
const hostMissing = HOST_KEPT_ROWS.filter((id) => !hostByEntry.has(id))
const hostInactive = HOST_KEPT_ROWS.filter((id) => {
  const host = hostByEntry.get(id)
  return host !== undefined && (!host.enabled || host.fiberPhase !== 'active')
})
pass(`all ${HOST_KEPT_ROWS.length} kept host rows enabled+active`,
  hostMissing.length === 0 && hostInactive.length === 0,
  [...hostMissing.map((id) => `${id}: absent`), ...hostInactive.map((id) => `${id}: ${describe(hostByEntry.get(id))}`)].join('; ') || 'active in the settled Loader tree')

// 3c-companion. mcp-browser（companion 浏览器执行面挂载，E1）：present + enabled + active。
const browserMcpEntry = hostByEntry.get('mcp-browser')
pass('mcp-browser (companion browser execution plane) enabled+active',
  browserMcpEntry !== undefined && browserMcpEntry.enabled && browserMcpEntry.fiberPhase === 'active',
  browserMcpEntry === undefined ? 'mcp-browser absent — dsh-mcp-client symlink 或 patch insert 缺失' : describe(browserMcpEntry))

// 3c-studio. eterna-prompt-studio（T1.2 生产挂载）：present + enabled + active。
// 产品可见性的机器证据之一（另一半=下方花名册断言）；亦已并入 HOST_KEPT_ROWS 循环。
const studioEntry = hostByEntry.get('eterna-prompt-studio')
pass('eterna-prompt-studio (prompt studio panel) enabled+active',
  studioEntry !== undefined && studioEntry.enabled && studioEntry.fiberPhase === 'active',
  studioEntry === undefined ? 'eterna-prompt-studio absent — profile node_modules symlink 或 patch insert 缺失' : describe(studioEntry))

// 3d. Preset kept rows: present, enabled, active in the default preset.
const standard = presetByName.get('standard')
pass('standard preset composed and default', standard !== undefined && standard.isDefault === true,
  standard === undefined ? 'preset standard missing from the roster' : `presets: ${[...presetByName.keys()].join(', ')}`)
if (standard !== undefined) {
  const rowById = new Map(standard.rows.map((row) => [row.entryId, row]))
  const presetMissing = PRESET_KEPT_ROWS.filter((id) => !rowById.has(id))
  const presetInactive = PRESET_KEPT_ROWS.filter((id) => {
    const row = rowById.get(id)
    return row !== undefined && (!row.enabled || row.fiberPhase !== 'active')
  })
  pass(`all ${PRESET_KEPT_ROWS.length} kept preset rows enabled+active in standard`,
    presetMissing.length === 0 && presetInactive.length === 0,
    [...presetMissing.map((id) => `${id}: absent`), ...presetInactive.map((id) => `${id}: ${JSON.stringify(rowById.get(id) && { enabled: rowById.get(id).enabled, fiberPhase: rowById.get(id).fiberPhase })}`)].join('; ') || 'flattened composition active')
}

// 3e. T1.2 浏览器半边：宿主 index.html 花名册含 @eterna/prompt-studio/client.js，
// 且该 combo 脚本可取、含本包 factory 注册（t7-ui-check.mjs:151-165 同款断言，
// 落在生产档真 boot——隔离档案不证明生产，ps-v2-test-plan §9 问题 1）。
if (!roster.ok) {
  pass('browser roster: index.html + combo 花名册取证', false, JSON.stringify(roster.error))
} else {
  const { html, ours, comboBody } = roster
  pass('browser roster: index.html 200 且注入 __DSH_BOOT__ 花名册',
    roster.status === 200 && html.includes('__DSH_BOOT__'),
    `status=${roster.status}, __DSH_BOOT__=${html.includes('__DSH_BOOT__')}`)
  pass('browser roster: combo 花名册含 @eterna/prompt-studio/client.js', ours !== undefined,
    ours === undefined ? 'combo urls 无本包条目——dsh.client 声明或 Loader 行缺席' : ours.slice(0, 120))
  pass('browser roster: 本包 combo 脚本可取且含 factory 注册(id=@eterna/prompt-studio)',
    comboBody !== '' && comboBody.includes('id: "@eterna/prompt-studio"'),
    comboBody === '' ? 'combo 取回为空' : `bytes=${comboBody.length}`)
  // 上下文压缩(2026-11-12 fork):设置分区 client 半边同款口径——花名册含
  // @eterna/compaction/client.js 且 factory 注册,否则设置弹窗分区不渲染。
  pass('browser roster: combo 花名册含 @eterna/compaction/client.js', roster.compactionCombo !== '',
    roster.compactionCombo === '' ? 'combo urls 无压缩包条目——dsh.client 声明或 lib/client.js 缺失' : roster.compactionCombo.slice(0, 120))
  pass('browser roster: 压缩包 combo 可取且含 factory 注册(id=@eterna/compaction)',
    roster.compactionBody !== '' && roster.compactionBody.includes('id: "@eterna/compaction"'),
    roster.compactionBody === '' ? 'combo 取回为空' : `bytes=${roster.compactionBody.length}`)
  // 附件入口(2026-11-12):工具行「附件」按钮 client 半边——花名册含
  // @eterna/attachments/client.js 且 factory 注册,否则按钮不渲染。
  pass('browser roster: combo 花名册含 @eterna/attachments/client.js', roster.attachmentsCombo !== '',
    roster.attachmentsCombo === '' ? 'combo urls 无附件包条目——dsh.client 声明或 lib/client.js 缺失' : roster.attachmentsCombo.slice(0, 120))
  pass('browser roster: 附件包 combo 可取且含 factory 注册(id=@eterna/attachments)',
    roster.attachmentsBody !== '' && roster.attachmentsBody.includes('id: "@eterna/attachments"'),
    roster.attachmentsBody === '' ? 'combo 取回为空' : `bytes=${roster.attachmentsBody.length}`)
  // 知识底座(2026-11-19 融合):@eterna/knowledge-admin 单宿主的侧栏/工作台半边,
  // 花名册与 factory 注册双证;缺席 = 11-19 事故复现(行在场但入口消失)。
  pass('browser roster: combo 花名册含 @eterna/knowledge-admin/client.js', roster.knowledgeCombo !== '',
    roster.knowledgeCombo === '' ? 'combo urls 无知识底座条目——dsh.client 声明或 lib/client.js 缺失' : roster.knowledgeCombo.slice(0, 120))
  pass('browser roster: 知识底座 combo 可取且含 factory 注册(id=@eterna/knowledge-admin)',
    roster.knowledgeBody !== '' && roster.knowledgeBody.includes('id: "@eterna/knowledge-admin"'),
    roster.knowledgeBody === '' ? 'combo 取回为空' : `bytes=${roster.knowledgeBody.length}`)
}

// ---------------------------------------------------------------------------
// 3f..3n. T11 出口面：模板形态 / 行集 / BOOT-004..007 / 槽位漂移 / BOOT-012。

const hostIds = new Set(snapshot.entries.map((entry) => entry.entryId.replace(/^include:/, '')))
const presetRowIds = new Set()
for (const preset of presetByName.values()) {
  for (const row of preset.rows) if (row.entryId !== null) presetRowIds.add(row.entryId)
}
const standardPreset = presetByName.get('standard')

// 3f. 模板形态（T10 交付数：43 blocks = 3 insert + 40 override；/clear 为组内嵌套行不占顶层口径）。
pass(`template shape: ${EXPECTED_TEMPLATE_BLOCKS} blocks = ${EXPECTED_TEMPLATE_INSERTS} insert + ${EXPECTED_TEMPLATE_OVERRIDES} override`,
  templateStats.blocks === EXPECTED_TEMPLATE_BLOCKS
    && templateStats.inserts === EXPECTED_TEMPLATE_INSERTS
    && templateStats.overrides.length === EXPECTED_TEMPLATE_OVERRIDES,
  `blocks=${templateStats.blocks}, insert=${templateStats.inserts}, override=${templateStats.overrides.length}, lines=${templateStats.lines}`)

// 3g. 0 unknown：每个 override id 必须在活体 Loader 树里（死行=启动只 warn 跳过、门禁假绿）。
const unknownOverrides = templateStats.overrides.filter((row) => !hostIds.has(row.id))
pass(`template overrides: ${EXPECTED_TEMPLATE_OVERRIDES - unknownOverrides.length}/${EXPECTED_TEMPLATE_OVERRIDES} resolve in live host tree (0 unknown)`,
  unknownOverrides.length === 0,
  unknownOverrides.length === 0
    ? 'all override ids present & settled'
    : unknownOverrides.map((row) => `${row.id}@line ${row.line}`).join('; '))

// 3h. host entry count（T11 交付口径：web 229）。
pass(`host entry count = ${EXPECTED_HOST_ENTRIES}`, snapshot.entries.length === EXPECTED_HOST_ENTRIES,
  `live=${snapshot.entries.length}, expected=${EXPECTED_HOST_ENTRIES}`)

// 3h-pre. 静默 disable 扫描（T11 §4.11 / 49 §10.2）：stderr 无 `disabling profile plugin`。
const disableLines = stderrText.split('\n').filter((line) => line.includes('disabling profile plugin'))
pass('boot stderr clean (no disabling profile plugin)', disableLines.length === 0,
  disableLines.length === 0
    ? 'stderr 无兼容性裁行记录'
    : `命中 ${disableLines.length} 行:${disableLines.slice(0, 5).map((line) => line.trim().slice(0, 180)).join(' | ')}`)

// 3i. BOOT-004：未知行 id / 未知 patch 目标计数 0（app-boot 的 patch 告警面）。
const unknownRowLines = output.join('').split('\n').filter((line) =>
  /unknown plugin row|patch(?: insert)?: entry "[^"]+" (?:not found|is not a group)|patch: name mismatch/i.test(line))
pass('BOOT-004 unknown plugin row count = 0', unknownRowLines.length === 0 && unknownOverrides.length === 0,
  unknownRowLines.length === 0
    ? `live patch targets all resolve (${templateStats.overrides.length} overrides)`
    : `命中 ${unknownRowLines.length} 行:${unknownRowLines.slice(0, 5).map((line) => line.trim().slice(0, 180)).join(' | ')}`)

// 3j. BOOT-005：rc.5 已删除行不得复活（host 与 preset 两面都查）。
const REMOVED_ROWS = ['account-controller', 'office-to-pdf']
const removedHits = []
for (const id of REMOVED_ROWS) {
  if (hostIds.has(id)) removedHits.push(`${id}: host`)
  if (presetRowIds.has(id)) removedHits.push(`${id}: preset`)
}
pass('BOOT-005 deleted rows absent (account-controller, office-to-pdf)', removedHits.length === 0,
  removedHits.join('; ') || 'absent in host tree and every preset')

// 3k. BOOT-006：rc.5 新增行全在且 active。
const NEW_ROWS = ['agent-team', 'tool-agent-team', 'ui-agent-team', 'ui-file-actions', 'ui-context-menu',
  'mcp-manager', 'office-kit', 'skill-office', 'deepseek-chat-import']
const newRowProblems = NEW_ROWS.flatMap((id) => {
  const entry = hostByEntry.get(id)
  if (entry === undefined) return [`${id}: absent`]
  if (!entry.enabled || entry.fiberPhase !== 'active') return [`${id}: ${describe(entry)}`]
  return []
})
pass(`BOOT-006 rc.5 new rows present+active (${NEW_ROWS.length})`, newRowProblems.length === 0,
  newRowProblems.join('; ') || NEW_ROWS.join(', '))

// 3l. BOOT-007：preset-standard 整份重述后仍保留 rc.5 默认，无丢行。
const presetComposition = flattenPresetRows(copied, 'preset-standard')
let presetDrift = []
if (!presetComposition.ok) {
  presetDrift = [`预设解析失败:${presetComposition.error}`]
} else if (standardPreset === undefined) {
  presetDrift = ['standard preset missing']
} else {
  const liveRows = new Map(standardPreset.rows.map((row) => [row.entryId, row]))
  for (const row of presetComposition.rows) {
    const live = liveRows.get(row.id)
    if (live === undefined) { presetDrift.push(`${row.id}: absent`); continue }
    if (row.disabled === true && live.enabled !== false) {
      presetDrift.push(`${row.id}: declared disabled but enabled=${String(live.enabled)}`)
    }
    if (row.disabled === undefined && !(live.enabled === true && live.fiberPhase === 'active')) {
      presetDrift.push(`${row.id}: ${JSON.stringify({ enabled: live.enabled, fiberPhase: live.fiberPhase })}`)
    }
  }
}
pass('BOOT-007 preset-standard restatement retains rc.5 default rows', presetDrift.length === 0,
  presetDrift.join('; ') || `${presetComposition.rows?.length ?? 0} declared rows all present (disabled flags honored)`)

// 3m. 槽位漂移（T11 §4.11 硬约束）：本仓 packages/*/src/client 的注册面必须
// 命中活宿主的 slot catalog（served runner bundle 的 CLIENT_SLOT_API），且源码
// 声明面 == 浏览器实收 bundle 的注册面（无缺失/无多出）。只检查本形态实际挂载
// 的包：super 专属包（tasks/workbench）在 web 形态显式 SKIP，不冒充通过。
const declaredSlots = enumerateDeclaredSlots(join(repoRoot, 'packages'))
const mountedPackages = new Set()
for (const entry of snapshot.entries) {
  const match = /^@eterna\/([^/]+)/.exec(entry.moduleName)
  if (match !== null) mountedPackages.add(match[1])
}
const bootEntries = roster.ok ? (roster.boot?.entries ?? []) : []
const bootEntryIds = new Set(bootEntries.map((entry) => entry.id))
const servedBundles = roster.ok ? (roster.bundles ?? {}) : {}
const liveSlotCatalog = new Set(roster.ok ? (roster.liveSlots ?? []) : [])
const slotReports = []
const slotProblems = { missingCatalog: [], missingBundle: [], extraBundle: [], notInRoster: [], fetchFailed: [] }
let checkedSlotPackages = 0
for (const [pkg, keys] of [...declaredSlots.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (!mountedPackages.has(pkg)) {
    console.log(`SKIP  slot drift [${pkg}] — 本形态未挂载该包（${keys.size} 个声明槽位不参与）`)
    continue
  }
  checkedSlotPackages += 1
  const bundle = servedBundles[pkg]
  const served = new Set(bundle?.status === 200 ? extractSlotKeys(bundle.body) : [])
  const missingFromBundle = [...keys.keys()].filter((key) => !served.has(key))
  const extraInBundle = [...served].filter((key) => !keys.has(key))
  const missingFromCatalog = [...keys.keys()].filter((key) => !liveSlotCatalog.has(key))
  if (!bootEntryIds.has(`@eterna/${pkg}`)) slotProblems.notInRoster.push(pkg)
  if (bundle === undefined || bundle.status !== 200) slotProblems.fetchFailed.push(`${pkg}:${bundle?.status ?? 'none'}`)
  slotProblems.missingBundle.push(...missingFromBundle.map((key) => `${pkg}:${key}`))
  slotProblems.extraBundle.push(...extraInBundle.map((key) => `${pkg}:${key}`))
  slotProblems.missingCatalog.push(...missingFromCatalog.map((key) => `${pkg}:${key}`))
  slotReports.push({
    package: `@eterna/${pkg}`,
    declared: keys.size,
    served: served.size,
    missingFromBundle,
    extraInBundle,
    missingFromCatalog,
    bundleStatus: bundle?.status ?? 0,
    rosterEntry: bootEntryIds.has(`@eterna/${pkg}`),
    slots: [...keys.keys()],
    sources: Object.fromEntries([...keys.entries()].map(([key, files]) => [key, files])),
  })
  console.log(`SLOT  [${pkg}] declared=${keys.size} served=${served.size} missing=${missingFromBundle.length} extra=${extraInBundle.length} catalogMiss=${missingFromCatalog.length}`)
}
const declaredKeyTotal = slotReports.reduce((sum, report) => sum + report.declared, 0)
const familyCount = (prefix) => slotReports.reduce(
  (sum, report) => sum + report.slots.filter((key) => key.startsWith(prefix)).length, 0)
pass(`slot drift: all ${declaredKeyTotal} declared slot keys hit the live host slot catalog (${liveSlotCatalog.size} slots)`,
  liveSlotCatalog.size > 0 && slotProblems.missingCatalog.length === 0,
  liveSlotCatalog.size === 0
    ? 'live slot catalog unavailable（runner bundle 未取到）'
    : (slotProblems.missingCatalog.join('; ')
      || `settings.section=${familyCount('settings.section')}, conversation.*=${familyCount('conversation.')}, plugins.tab=${familyCount('plugins.tab')}`))
pass(`slot drift: ${checkedSlotPackages} mounted packages — declared == served (no missing / no extra)`,
  checkedSlotPackages > 0 && slotProblems.missingBundle.length === 0 && slotProblems.extraBundle.length === 0,
  [...slotProblems.missingBundle.map((item) => `missing ${item}`),
    ...slotProblems.extraBundle.map((item) => `extra ${item}`)].join('; ')
    || 'source declarations and served client bundles agree')
pass('slot drift: every mounted slot-declaring package has a __ModuleLoader__ entry',
  slotProblems.notInRoster.length === 0 && slotProblems.fetchFailed.length === 0 && bootEntries.length > 0,
  [...slotProblems.notInRoster.map((pkg) => `${pkg}: no boot entry`),
    ...slotProblems.fetchFailed.map((item) => `${item}: bundle fetch failed`)].join('; ')
    || `${checkedSlotPackages} packages present in roster`)

// 3n. BOOT-012：浏览器花名册完整（T36 产品 client bundle 全部在册、可取、
// factory 注册在；release.version 与宿主 dsh 一致）。真实浏览器的
// 「版本不匹配」控制台面仍需 E1/容器（W5），本断言覆盖花名册/工件半边。
const dshVersion = readDshVersion()
const bootProblems = []
if (!roster.ok || roster.boot === undefined) {
  bootProblems.push('__DSH_BOOT__ 花名册不可读')
} else {
  if (roster.boot.release?.version !== dshVersion) {
    bootProblems.push(`release.version=${String(roster.boot.release?.version)}, dsh=${dshVersion}`)
  }
  for (const entry of bootEntries) {
    if (typeof entry.url !== 'string' || typeof entry.rev !== 'string') {
      bootProblems.push(`${String(entry.id)}: 花名册缺 url/rev`)
      break
    }
  }
  for (const pkg of T36_PRODUCT_CLIENT_PACKAGES) {
    if (!mountedPackages.has(pkg)) continue
    if (!bootEntryIds.has(`@eterna/${pkg}`)) bootProblems.push(`${pkg}: 不在花名册`)
    const bundle = servedBundles[pkg]
    if (bundle === undefined || bundle.status !== 200) bootProblems.push(`${pkg}: bundle ${bundle?.status ?? 0}`)
    else if (!bundle.body.includes(`id: "@eterna/${pkg}"`)) bootProblems.push(`${pkg}: 无 factory 注册`)
  }
}
const t36Mounted = T36_PRODUCT_CLIENT_PACKAGES.filter((pkg) => mountedPackages.has(pkg))
pass(`BOOT-012 client roster complete: T36 ${t36Mounted.length}/${T36_PRODUCT_CLIENT_PACKAGES.length} mounted bundles + release`,
  bootProblems.length === 0,
  bootProblems.join('; ') || `${bootEntries.length} boot entries, release ${String(roster.boot?.release?.version)}, ${t36Mounted.join(', ')}`)

// ---------------------------------------------------------------------------
// 4. Verdict.

// 证据落盘（默认关闭；T11 验收用 ETERNA_EVIDENCE_DIR 打开）：日志先脱敏。
if (EVIDENCE_DIR !== undefined && EVIDENCE_DIR !== '') {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeFileSync(join(EVIDENCE_DIR, 'inventory.json'), `${JSON.stringify(snapshot, null, 1)}\n`)
  writeFileSync(join(EVIDENCE_DIR, 'boot.stdout.log'), sanitizeLog(stdoutText))
  writeFileSync(join(EVIDENCE_DIR, 'boot.stderr.log'), sanitizeLog(stderrText))
  writeFileSync(join(EVIDENCE_DIR, 'template-stats.json'), `${JSON.stringify(templateStats, null, 1)}\n`)
  writeFileSync(join(EVIDENCE_DIR, 'slot-drift.json'), `${JSON.stringify({
    profile: profileName,
    liveSlotCatalogSize: liveSlotCatalog.size,
    checkedPackages: checkedSlotPackages,
    packages: slotReports,
  }, null, 1)}\n`)
  writeFileSync(join(EVIDENCE_DIR, 'preset-standard.json'), `${JSON.stringify({
    declaredRows: presetComposition.rows ?? [],
    drift: presetDrift,
  }, null, 1)}\n`)
  console.log(`verify-eterna-web: evidence -> ${EVIDENCE_DIR}`)
}

// boot 行走 stderr:它含每次运行随机的端口与 token,进 stdout 会使 G3-M1 ③ 的基线 diff
// (docs/baselines/verify-eterna-web-m0.txt,stdout 全量口径)结构性永不为空(40 号 S-8
// 剩余项的口径修正:boot 行随机面不属"base 形态不受扰动"的判定面;PASS/FAIL 与 verdict
// 仍是 stdout 全量)。token 不落任何被跟踪文件(AGENTS.md 凭据纪律)。
console.error(`verify-eterna-web: boot ${urlLine}`)
console.log(failures.length === 0
  ? `verify-eterna-web: OK — ${snapshot.entries.length} host entries, ${presetByName.size} presets, cut rows inactive, kept rows active`
  : `verify-eterna-web: FAILED — ${failures.join('; ')}`)
process.exitCode = failures.length === 0 ? 0 : 1

// ---------------------------------------------------------------------------

function describe(entry) {
  return entry === undefined ? 'absent' : `${entry.enabled ? 'enabled' : 'disabled'}/${entry.fiberPhase ?? 'no-fiber'}`
}

/**
 * 模板形态（T10/T11 同口径）：顶层 `- ` block = insert 块或 override 行。
 * @param text - patch 模板原文。
 * @returns 行数、顶层 block 数、insert 块数、override 行（id + 行号）。
 */
function summarizeTemplate(text) {
  const lines = text.split('\n')
  const overrides = []
  let blocks = 0
  let inserts = 0
  for (let index = 0; index < lines.length; index += 1) {
    const block = /^- (.*)$/.exec(lines[index])
    if (block === null) continue
    blocks += 1
    const id = /^id:\s*(\S+)\s*$/.exec(block[1])
    if (id !== null) {
      overrides.push({ id: id[1], line: index + 1 })
      continue
    }
    if (/^insert:\s*$/.test(block[1])) inserts += 1
  }
  return { lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), blocks, inserts, overrides }
}

/** yaml 从 tools/packctl 依赖树解析（与 migrate-mcp-servers.mjs 同源）；缺失不炸脚本。 */
function loadYamlForVerify() {
  try {
    return createRequire(join(repoRoot, 'tools', 'packctl', 'package.json'))('yaml')
  } catch {
    return undefined
  }
}

/**
 * preset 整份重述的扁平行集（BOOT-007）：跳过 group 行本身、递归 group config，
 * 保留每行的 id（无 id 用 name）与显式 disabled 标记。
 * @param patchText - 模板原文。
 * @param presetId - 例如 `preset-standard`。
 * @returns {ok, rows} 或 {ok:false,error}。
 */
function flattenPresetRows(patchText, presetId) {
  const yaml = loadYamlForVerify()
  if (yaml === undefined) return { ok: false, error: 'yaml 不可解析（tools/packctl/node_modules/yaml）' }
  let data
  try {
    const doc = yaml.parseDocument(patchText, { strict: false })
    if (doc.errors.length > 0) {
      return { ok: false, error: `YAML 解析失败:${String(doc.errors[0]?.message ?? doc.errors[0]).split('\n')[0].slice(0, 200)}` }
    }
    data = doc.toJS({ maxAliasCount: 1000 })
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
  if (!Array.isArray(data)) return { ok: false, error: '顶层不是补丁数组' }
  const preset = data.find((entry) => entry !== null && typeof entry === 'object' && entry.id === presetId)
  const plugins = preset?.config?.plugins
  if (!Array.isArray(plugins)) return { ok: false, error: `${presetId} 行无 config.plugins` }
  const rows = []
  const walk = (list) => {
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') continue
      if (Array.isArray(entry.config)) { walk(entry.config); continue }
      if (entry.name === 'cordis:group') continue
      const id = typeof entry.id === 'string' ? entry.id : (typeof entry.name === 'string' ? entry.name : undefined)
      if (id === undefined) continue
      rows.push({ id, disabled: entry.disabled })
    }
  }
  walk(plugins)
  return { ok: true, rows }
}

/**
 * 源码注册面枚举：packages/<pkg>/src/client 下所有 `slots.inject('key'` 字面量。
 * 注释先剥离（头注/契约说明大量出现槽位名，不剥会把文档当声明）。
 * @param packagesRoot - 仓库 packages 目录。
 * @returns Map<pkg, Map<key, sourceFile[]>>。
 */
function enumerateDeclaredSlots(packagesRoot) {
  const byPackage = new Map()
  const strip = (text) => {
    let out = ''
    let index = 0
    let quote = null
    while (index < text.length) {
      const current = text[index]
      const next = text[index + 1]
      if (quote !== null) {
        out += current
        if (current === '\\') { out += text[index + 1] ?? ''; index += 2; continue }
        if (current === quote) quote = null
        index += 1
        continue
      }
      if (current === '/' && next === '/') {
        while (index < text.length && text[index] !== '\n') index += 1
        continue
      }
      if (current === '/' && next === '*') {
        index += 2
        let newlines = ''
        while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
          if (text[index] === '\n') newlines += '\n'
          index += 1
        }
        index += 2
        // 保留行号与 token 分隔：块注释折算为空格 + 原有换行。
        out += ` ${newlines}`
        continue
      }
      if (current === '\'' || current === '"' || current === '`') quote = current
      out += current
      index += 1
    }
    return out
  }
  const visit = (dir, pkg) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { visit(full, pkg); continue }
      if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue
      const source = strip(readFileSync(full, 'utf8'))
      for (const match of source.matchAll(/slots\.inject\(\s*(['"`])([^'"`]+)\1/g)) {
        const key = match[2]
        if (!byPackage.has(pkg)) byPackage.set(pkg, new Map())
        const bucket = byPackage.get(pkg)
        if (!bucket.has(key)) bucket.set(key, [])
        const relative = full.slice(repoRoot.length + 1)
        const line = source.slice(0, match.index ?? 0).split('\n').length
        bucket.get(key).push(`${relative}:${line}`)
      }
    }
  }
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const clientDir = join(packagesRoot, entry.name, 'src', 'client')
    if (existsSync(clientDir)) visit(clientDir, entry.name)
  }
  return byPackage
}

/** 从一段 client bundle / 源码里取 `slots.inject('key'` 字面量集合。 */
function extractSlotKeys(code) {
  return [...new Set([...code.matchAll(/slots\.inject\(\s*(['"`])([^'"`]+)\1/g)].map((match) => match[2]))]
}

/**
 * 活宿主槽位契约：served runner bundle 里 `CLIENT_SLOT_API=[...]` 的 key 集。
 * 用括号配对切出数组（bundle 是压缩后的单行，正则跨不过嵌套模板串）。
 * @param bundle - 浏览器实收的 runner client.js。
 * @returns 槽位 key 数组（空数组=未取到契约）。
 */
function extractLiveSlotCatalog(bundle) {
  const marker = bundle.indexOf('CLIENT_SLOT_API')
  if (marker < 0) return []
  const start = bundle.indexOf('[', marker)
  if (start < 0) return []
  let depth = 0
  let quote = null
  let end = -1
  for (let index = start; index < bundle.length; index += 1) {
    const current = bundle[index]
    if (quote !== null) {
      if (current === '\\') { index += 1; continue }
      if (current === quote) quote = null
      continue
    }
    if (current === '\'' || current === '"' || current === '`') { quote = current; continue }
    if (current === '[') depth += 1
    else if (current === ']') {
      depth -= 1
      if (depth === 0) { end = index; break }
    }
  }
  if (end < 0) return []
  const slice = bundle.slice(start, end + 1)
  return [...new Set([...slice.matchAll(/\bkey:\s*([`'"])([^`'"]+)\1\s*,\s*kind:\s*([`'"])([^`'"]+)\3/g)].map((match) => match[2]))]
}

/** 宿主 dsh 版本（BOOT-012 release.version 对照）。 */
function readDshVersion() {
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

/** 证据脱敏：boot URL 的会话 token 不落盘（AGENTS.md 凭据纪律）。 */
function sanitizeLog(text) {
  return text.replace(/token=[A-Za-z0-9_-]+/g, 'token=<redacted>')
}

/** One authenticated pluginInventory/list call against the booted web host. */
async function probe(url) {
  const index = new URL(url)
  const auth = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  const cookie = auth.headers.get('set-cookie')?.split(';')[0]
  if (!auth.ok && auth.status !== 303) {
    return { ok: false, error: { code: 'auth', message: `index request returned ${auth.status}` } }
  }
  const response = await fetch(new URL('/api/pluginInventory/list', index.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-eterna-web', method: 'pluginInventory/list', payload: { args: {} } }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  const body = await response.json().catch((error) => ({ parseError: String(error) }))
  if (response.status !== 200 || body.type !== 'server-response' || body.result === undefined) {
    return { ok: false, error: { code: 'transport', message: `POST /api/pluginInventory/list -> ${response.status}`, body } }
  }
  return body.result
}

/**
 * 浏览器会话三步换票（/connect token→cookie → /?token= 会话升级 → / 最终 200
 * HTML，照抄 t7-ui-check.mjs:96-110），取证 index.html 花名册与 @eterna/prompt-studio
 * combo 脚本。任一步失败返回 {ok:false,error}，不抛出（取证失败转断言红）。
 */
async function probeRoster(url) {
  try {
    const index = new URL(url)
    const token = index.searchParams.get('token')
    if (token === null) return { ok: false, error: { code: 'token', message: `boot url 无 token: ${url}` } }
    let cookie
    const step = async (u) => {
      const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: cookie === undefined ? {} : { cookie } })
      const set = res.headers.get('set-cookie')
      if (set !== null) cookie = set.split(';')[0]
      return res
    }
    const connect = await step(`${index.origin}/connect?token=${token}&interactions=answer`)
    if (connect.headers.get('set-cookie') === null) return { ok: false, error: { code: 'connect', message: `/connect 无 set-cookie (status=${connect.status})` } }
    const upgrade = await step(`${index.origin}/?token=${token}`)
    if (upgrade.status === 303) await step(`${index.origin}/`)
    const page = await fetch(index.origin, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const html = await page.text()
    const comboUrls = [...html.matchAll(/(plugins\/\?\?[^"']+client\.js[^"']*)/g)]
      .map((m) => m[1].replaceAll('&amp;', '&'))
    const ours = comboUrls.find((u) => u.includes('@eterna/prompt-studio/client.js'))
    let comboBody = ''
    if (ours !== undefined) {
      const combo = await fetch(`${index.origin}/${ours.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) comboBody = await combo.text()
    }
    // 上下文压缩(2026-11-12 fork):设置分区 client 半边的花名册取证,同款口径。
    const compactionCombo = comboUrls.find((u) => u.includes('@eterna/compaction/client.js')) ?? ''
    let compactionBody = ''
    if (compactionCombo !== '') {
      const combo = await fetch(`${index.origin}/${compactionCombo.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) compactionBody = await combo.text()
    }
    // 附件入口(2026-11-12):输入框工具行按钮 client 半边的花名册取证,同款口径。
    const attachmentsCombo = comboUrls.find((u) => u.includes('@eterna/attachments/client.js')) ?? ''
    let attachmentsBody = ''
    if (attachmentsCombo !== '') {
      const combo = await fetch(`${index.origin}/${attachmentsCombo.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) attachmentsBody = await combo.text()
    }
    // 知识底座(2026-11-19 融合):侧栏「知识库」+ 工作台 client 半边的花名册取证。
    // 这是 11-19 事故的回归面——行在场但 lib/client.js 不收录,侧栏入口静默消失。
    const knowledgeCombo = comboUrls.find((u) => u.includes('@eterna/knowledge-admin/client.js')) ?? ''
    let knowledgeBody = ''
    if (knowledgeCombo !== '') {
      const combo = await fetch(`${index.origin}/${knowledgeCombo.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) knowledgeBody = await combo.text()
    }
    // T11 槽位漂移取证：__DSH_BOOT__ 花名册给出每个 client entry 的独立 URL；
    // runner 的 client bundle 内嵌 CLIENT_SLOT_API（活宿主编译期槽位契约），
    // 各 @eterna 包的 bundle 是浏览器实际收到的注册面。两者与源码枚举比对。
    const bootMatch = html.match(/__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)
    let boot
    try {
      boot = bootMatch === null ? undefined : JSON.parse(bootMatch[1])
    } catch {
      boot = undefined
    }
    const bundles = {}
    let liveSlots = []
    if (boot !== undefined && Array.isArray(boot.entries)) {
      for (const entry of boot.entries.filter((candidate) => typeof candidate.id === 'string' && candidate.id.startsWith('@eterna/'))) {
        const pkg = entry.id.split('/')[1]
        try {
          const res = await fetch(`${index.origin}/${String(entry.url).replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
          bundles[pkg] = { status: res.status, body: res.ok ? await res.text() : '' }
        } catch (error) {
          bundles[pkg] = { status: 0, body: '', error: String(error?.message ?? error) }
        }
      }
      const runnerEntry = boot.entries.find((candidate) => candidate.id === '@deepseek-ai/dsh-cordis-client-runner')
      if (runnerEntry !== undefined) {
        try {
          const res = await fetch(`${index.origin}/${String(runnerEntry.url).replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
          if (res.ok) liveSlots = extractLiveSlotCatalog(await res.text())
        } catch {
          liveSlots = []
        }
      }
    }
    return {
      ok: true, status: page.status, html, ours, comboBody, compactionCombo, compactionBody,
      attachmentsCombo, attachmentsBody, knowledgeCombo, knowledgeBody,
      boot, bundles, liveSlots,
    }
  } catch (error) {
    return { ok: false, error: { code: 'roster', message: String(error?.message ?? error) } }
  }
}

/** Bounded shutdown: SIGTERM, then SIGKILL after the grace period. */
async function stop(childProcess) {
  if (childProcess.exitCode !== null) return
  childProcess.kill('SIGTERM')
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      childProcess.kill('SIGKILL')
      resolveStop()
    }, 5000)
    childProcess.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
  })
}
