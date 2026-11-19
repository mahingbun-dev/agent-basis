#!/usr/bin/env node
/**
 * Real-boot verification for the Eterna super 形态 (profiles/eterna-super).
 *
 * 复制 verify-eterna-web.mjs 模式(33 号 G1-2「同 G1-1 口径,对 super 挂载面」;
 * 40 号 S-6):物化 profile → 真 boot 等 readiness 行 → pluginInventory 活体断言 →
 * 浏览器花名册取证 → 有界停机。与母本仅四处差异,其余逐字同源:
 *
 *  1. sourcePatch = profiles/eterna-super/cordis.patch.yml;profileName=eterna-super;
 *     home 缺省 <repo>/.eterna-super-home(ETERNA_PROFILE_HOME 覆盖,与 base 验证
 *     home 隔离互不污染;40 号 §9 Q2)。
 *  2. super 挂载面断言:挂载清单内全部 @eterna insert 行 present+enabled+ACTIVE
 *     ——行集从清单**派生**(挂一行、验一行),随包落地自动扩展;G1-2 判据原文
 *     「tasks/channels/workbench/toolkit 挂载行 active」即此断言在四包全部落地
 *     (M4)后的终态,不需要分阶段维护行表。
 *  3. 无同 id 冲突(G1-2 原文):pluginInventory 快照内 entryId 无重复且 0 failed
 *     (0 failed 由母本 3a 断言天然覆盖;重复 id 为本脚本新增遍历)。
 *  4. CUT_ROWS / 宿主与预设保留行 / 花名册断言原样继承(super 裁切面=base,
 *     40 号 S-3 纪律 3)。「行序正确」由 FORM001 的按序比对静态看护(40 号 §9 Q6),
 *     本脚本只断言 active——两命令分工。
 *
 * 凭据纪律与母本同:无模型调用、无凭据、OS 随机端口(--port 0),CI 可跑。
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
// patch 源=容器模板（2026-11-18 端到端缺口修复）：40 号 S-3 表第 6 行已记录 base 两
// 工件实质漂移——容器模板含 18 条挂载行（治理三件套/access/panel 等生产挂载），
// 开发档 profiles/* 只是裁切层（7 条）。容器 /login、/access/api 之所以可用，靠的
// 是 entrypoint 渲染 docker 模板 + 第 3 步全量 symlink。本地 verify 要与容器同口径
// （ETERNA_FORM 渲染语义），故源取 docker 模板、symlink 全量清单；断言面（HOST_KEPT
//_ROWS 的 eterna-* 段）与此对应。profiles/eterna-super/cordis.patch.yml 仍作 FORM001
// 的漂移看护对象（packctl form-check 校验其与模板挂载行一致）。
const sourcePatch = join(repoRoot, 'docker', 'profile', 'cordis.super.patch.yml.template')
const home = resolve(process.env.ETERNA_PROFILE_HOME ?? join(repoRoot, '.eterna-super-home'))
const profileName = 'eterna-super'
const profileDir = join(home, 'profiles', profileName)

const BOOT_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 10_000

/** Rows the enterprise Web 档 cuts (plans §11.2/§11.3/§11.8)——super 裁切面继承 base。 */
const CUT_ROWS = [
  // 遥测两处
  'otel', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics',
  // 凭据库 + 账号体系（credentials 保留：connection 必需行硬依赖，见 docs）
  'authorization', 'deepseek-account', 'llm-deepseek', 'llm-deepseek-account',
  'account-controller', 'ui-settings-account',
  // ptc 家族修订（2026-11-09）：创造模式（preset-cordis）回加后 ptc-runtime/
  // workflow-ptc/tool-workflow 三行宿主回加（workflow-ptc 硬依赖 ptcRuntime
  // 服务）；仅 tool-executor-ptc 维持裁切。标准会话经 preset-standard 内
  // disabled 不可见。另本就 disabled 的两行
  'tool-executor-ptc', 'fs-observation-policy', 'tool-plugin-manager', 'ui-workflow-run',
  // 场景裁切（shortcuts 不在此列：client 服务根，2026-11-09 浏览器 E2E 教训——
  // 裁掉即 26 个 client-ui 插件 web boot 全家 pending，宿主侧断言照绿）
  'office-to-pdf', 'open-in-app', 'ui-open-in-app', 'ui-shortcuts',
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
  'goal', 'goal-round-driver', 'subagent', 'subagent-spawn-in-process', 'subagent-fork-in-process',
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
  // 企业挂载面（2026-11-18 补断言）：治理三行 + access/brand/llm-doctor/usage-stats
  // ——2026-11-17 端到端发现：symlink 缺链时这些行静默不激活且原断言面不覆盖，
  // /login 404、/access/api 无守卫。此处与 BASE_MOUNT_PACKAGES 一一对应防回归。
  'eterna-governance', 'eterna-audit', 'eterna-egress', 'eterna-access',
  'eterna-brand', 'eterna-llm-doctor', 'eterna-usage-stats',
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
]

/** Kept rows that live behind agent presets: present + enabled + active in `standard`. */
const PRESET_KEPT_ROWS = [
  'tool-bash', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-schedule',
  'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'plan-mode',
  'compaction-basic', 'command-compact', 'tool-result-pruner',
  'stale-tool-result-pruner',
  'tool-subagent-control', 'tool-subagent', 'tool-subagent-fork',
  'tool-todo', 'tool-web', 'agent-instructions', 'tool-ask-user',
]

/** super 形态的 Tier2/接线包(守卫式 symlink:目录存在才建链,镜像 entrypoint 第 3 步同款)。 */
const SUPER_FUTURE_PACKAGES = ['tasks', 'channels', 'interact', 'workbench', 'toolkit']

// ---------------------------------------------------------------------------
// 1. Materialize the profile under the DSH home.

if (!existsSync(dshBin)) {
  console.error(`verify-eterna-super: dsh CLI not found at ${dshBin}; run pnpm install first`)
  process.exit(1)
}
if (!existsSync(sourcePatch)) {
  console.error(`verify-eterna-super: missing ${sourcePatch}`)
  process.exit(1)
}
const homePatch = join(home, 'cordis.patch.yml')
if (existsSync(homePatch)) {
  console.error(`verify-eterna-super: ${homePatch} exists; a home-level user patch would compose over the profile layer and break determinism — remove it or point ETERNA_PROFILE_HOME at a clean home`)
  process.exit(1)
}

rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
// 创造模式（preset-cordis）硬依赖：skill-filesystem 的 customSkillDirs 表达式
// 以 createRequire(baseUrl) 解析 @deepseek-ai/dsh-agent-preset（baseUrl=profile
// 目录）——必须把该包链接进 profile node_modules，否则 skill-filesystem 条目
// failed（2026-11-09 实测 MODULE_NOT_FOUND）。rc.1 已钉版，取 .pnpm 内唯一实装。
const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
const presetCandidates = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).filter((dir) => dir.startsWith('@deepseek-ai+dsh-agent-preset@0.2.2-rc.1'))
  : []
if (presetCandidates.length === 0) {
  console.error('verify-eterna-super: @deepseek-ai/dsh-agent-preset@0.2.2-rc.1 未安装——创造模式 skill 目录无法解析')
  process.exit(1)
}
const agentPresetDir = join(pnpmDir, presetCandidates[0], 'node_modules', '@deepseek-ai', 'dsh-agent-preset')
const profileNodeModules = join(profileDir, 'node_modules', '@deepseek-ai')
mkdirSync(profileNodeModules, { recursive: true })
symlinkSync(agentPresetDir, join(profileNodeModules, 'dsh-agent-preset'), 'dir')
// companion 浏览器执行面（E1）：dsh-mcp-client 插件（mcp-browser 条目的 name 引用）
const mcpClientCandidates = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).filter((dir) => dir.startsWith('@deepseek-ai+dsh-mcp-client@0.2.2-rc.1'))
  : []
if (mcpClientCandidates.length === 0) {
  console.error('verify-eterna-super: @deepseek-ai/dsh-mcp-client@0.2.2-rc.1 未安装——mcp-browser 条目无法解析')
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
  console.error('verify-eterna-super: packages/prompt-studio/lib/client.js 缺失——先跑 pnpm --filter @eterna/prompt-studio run verify（build:client）')
  process.exit(1)
}
mkdirSync(join(profileDir, 'node_modules', '@eterna'), { recursive: true })
symlinkSync(promptStudioPkg, join(profileDir, 'node_modules', '@eterna', 'prompt-studio'), 'dir')
// 附件入口（2026-11-12 生产挂载）：insert 行 name 解析 '@eterna/attachments'
// 同样只经 profile node_modules；客户端双面包需宿主 Loader 条目 + lib/client.js。
const attachmentsPkg = join(repoRoot, 'packages', 'attachments')
if (!existsSync(join(attachmentsPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-super: packages/attachments/lib/client.js 缺失——先跑 pnpm --filter @eterna/attachments run verify（build:client）')
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
  console.error('verify-eterna-super: packages/memory/lib/client.js 缺失——先跑 pnpm --filter @eterna/memory run verify（build:client）')
  process.exit(1)
}
symlinkSync(memoryPkg, join(profileDir, 'node_modules', '@eterna', 'memory'), 'dir')
// 任务内核客户端半边（2026-11-19 会话级 super 标记 + 任务设置分区）：eterna-tasks
// 是双面包——设置分区「任务与超级智能体」与会话头角色徽标都从 lib/client.js
// 载入浏览器；缺失时两件静默不渲染（pre-restart 不拦，只能靠本断言）。
const tasksPkg = join(repoRoot, 'packages', 'tasks')
if (!existsSync(join(tasksPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-super: packages/tasks/lib/client.js 缺失——先跑 pnpm --filter @eterna/tasks run verify（build:client）')
  process.exit(1)
}
// base 模板 insert 面其余 @eterna 行的 symlink（2026-11-18 端到端缺口修复）：治理面
// 三行 name='@eterna/glue/*-plugin'、记忆 = glue memory-plugin；知识底座 =
// @eterna/knowledge-admin 单宿主（2026-11-19 融合：四工具 + 知识库工作台 + 账号面）。
// access/brand/llm-doctor/usage-stats 各行同样只经 profile node_modules 解析——缺链时
// Loader 静默跳过（boot log clean），行不激活但 verify 原断言面不覆盖（/login 404、
// /access/api 无守卫）。镜像侧由 entrypoint 第 3 步全量清单承担；本地 verify 同口径补齐。
const knowledgeAdminPkg = join(repoRoot, 'packages', 'knowledge-admin')
if (!existsSync(join(knowledgeAdminPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-super: packages/knowledge-admin/lib/client.js 缺失——先跑 pnpm --filter @eterna/knowledge-admin run build:client')
  process.exit(1)
}
const BASE_MOUNT_PACKAGES = ['glue', 'llm-doctor', 'brand', 'panel', 'llm-openai', 'access', 'usage-stats', 'governance', 'knowledge-admin']
for (const pkg of BASE_MOUNT_PACKAGES) {
  symlinkSync(join(repoRoot, 'packages', pkg), join(profileDir, 'node_modules', '@eterna', pkg), 'dir')
}
// super 形态守卫式补链（40 号 S-5 镜像 entrypoint 第 3 步同款清单）：Tier2/接线包
// 目录存在才建链。挂载行随包落地 PR 加入清单后本脚本
// 「挂一行、验一行」断言随之生效，无需改这里。
const superGuardedLinks = []
for (const pkg of SUPER_FUTURE_PACKAGES) {
  if (existsSync(join(repoRoot, 'packages', pkg))) {
    symlinkSync(join(repoRoot, 'packages', pkg), join(profileDir, 'node_modules', '@eterna', pkg), 'dir')
    superGuardedLinks.push(pkg)
  }
}
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: `dsh-profile-${profileName}`,
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, null, 2)}\n`)
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
copyFileSync(sourcePatch, join(profileDir, 'cordis.patch.yml'))
const copied = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
if (copied !== readFileSync(sourcePatch, 'utf8')) {
  console.error('verify-eterna-super: profile patch copy drifted from the source file')
  process.exit(1)
}

/**
 * super 挂载面行集（从清单派生,40 号 S-6 差异点 2）:insert 块内 @eterna 行的
 * id+name 按出现序(与 packctl form-check 的 FORM001 提取口径同源——form.ts
 * extractEternaMountRows;行序由 FORM001 静态看护,此处只取集合供 active 断言)。
 */
function extractEternaMountRows(text) {
  const rows = []
  let inInsert = false
  let pendingId
  for (const line of text.split('\n')) {
    if (/^-\s+insert:\s*$/.test(line)) { inInsert = true; pendingId = undefined; continue }
    if (/^\S/.test(line)) { inInsert = false; pendingId = undefined; continue }
    if (!inInsert) continue
    const idMatch = /^\s+- id:\s*(\S+)\s*$/.exec(line)
    if (idMatch !== null) { pendingId = idMatch[1]; continue }
    const nameMatch = /^\s+name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line)
    if (nameMatch !== null && pendingId !== undefined) {
      if (nameMatch[1].startsWith('@eterna/')) rows.push({ id: pendingId, name: nameMatch[1] })
      pendingId = undefined
    }
  }
  return rows
}
const superMountRows = extractEternaMountRows(copied)
console.log(`verify-eterna-super: 挂载面清单派生 ${superMountRows.length} 行 @eterna insert(守卫式补链:${superGuardedLinks.join(', ') || '无'})`)

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
  console.error(`verify-eterna-super: boot failed: ${error.message}`)
  console.error('--- dsh output ---')
  console.error(output.join(''))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Probe the live inventory.

const result = await probe(urlLine)
// 浏览器花名册取证（母本同款;须在 stop 前对活宿主取证）。
const roster = await probeRoster(urlLine)
await stop(child)

if (!result.ok) {
  console.error(`verify-eterna-super: pluginInventory/list failed: ${JSON.stringify(result.error)}`)
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

// 3-pre. 启动日志洁净（无 skipping/incompatible——装载被跳过或版本不兼容时
// 宿主只打日志不进 failed 相位,母本 t7-ui-check.mjs:127 同款口径)。
const skipLines = output.join('').split('\n').filter(line => /skipping|incompatible/i.test(line))
pass('boot log clean (no skipping/incompatible)', skipLines.length === 0,
  skipLines.length === 0
    ? 'boot + probe 期间 stdout/stderr 无装载跳过或版本不兼容记录'
    : `命中 ${skipLines.length} 行(前 8 行):\n${skipLines.slice(0, 8).map(l => `    ${l.trim().slice(0, 220)}`).join('\n')}`)

// 3a. No failed rows: a failed row means an injection chain broke (e.g. a cut
// row still has a hard consumer) — fatal even when the audit only warns.
const failed = snapshot.entries.filter((entry) => entry.fiberPhase === 'failed')
pass('no failed entries', failed.length === 0,
  failed.map((entry) => `${entry.entryId}: ${entry.diagnostic ?? 'failed'}`).join(' | ') || `${snapshot.entries.length} entries settled`)

// 3a-dup. 无同 id 冲突（G1-2 原文,40 号 S-6 差异点 3）:快照内 entryId 无重复。
const entryIdCounts = new Map()
for (const entry of snapshot.entries) entryIdCounts.set(entry.entryId, (entryIdCounts.get(entry.entryId) ?? 0) + 1)
const duplicateIds = [...entryIdCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`)
pass('no duplicate entryId in pluginInventory', duplicateIds.length === 0,
  duplicateIds.join('; ') || `${snapshot.entries.length} entry ids all unique`)

// 3b. Cut rows: absent or disabled in the host tree, and not enabled in any preset
// （super 裁切面继承 base,40 号 S-3 纪律 3）。
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

// 3c-super. super 挂载面断言（40 号 S-6 差异点 2,行集从清单派生）:挂载清单内
// 全部 @eterna insert 行 present+enabled+ACTIVE——挂一行、验一行,随包落地自动
// 扩展;G1-2「tasks/channels/workbench/toolkit 挂载行 active」即四包落地后的终态。
const superFaceMissing = superMountRows.filter((row) => !hostByEntry.has(row.id))
const superFaceInactive = superMountRows.filter((row) => {
  const host = hostByEntry.get(row.id)
  return host !== undefined && (!host.enabled || host.fiberPhase !== 'active')
})
pass(`super 挂载面:清单派生 ${superMountRows.length} 行 @eterna insert 全部 enabled+active`,
  superFaceMissing.length === 0 && superFaceInactive.length === 0,
  [...superFaceMissing.map((row) => `${row.id}(${row.name}): absent——symlink 或 insert 行缺失`),
    ...superFaceInactive.map((row) => `${row.id}(${row.name}): ${describe(hostByEntry.get(row.id))}`)].join('; ')
    || superMountRows.map((row) => row.id).join(', '))

// 3c-companion. mcp-browser（companion 浏览器执行面挂载，E1）：present + enabled + active。
// 本地裸跑无 /repo：boot 日志里 browser-relay '/repo/packages/browser-relay/dist/mcp.mjs' 的 MODULE_NOT_FOUND 告警属容器时代路径（模板 args 写死 /repo，容器内由镜像 WORKDIR=/repo 承担），本地预期内——仅注释说明，不改本断言逻辑。
const browserMcpEntry = hostByEntry.get('mcp-browser')
pass('mcp-browser (companion browser execution plane) enabled+active',
  browserMcpEntry !== undefined && browserMcpEntry.enabled && browserMcpEntry.fiberPhase === 'active',
  browserMcpEntry === undefined ? 'mcp-browser absent — dsh-mcp-client symlink 或 patch insert 缺失' : describe(browserMcpEntry))

// 3c-studio. eterna-prompt-studio（T1.2 生产挂载）：present + enabled + active。
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

// 3e. 浏览器半边花名册取证（母本原样继承;super 初始挂载面=base）。
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
  // 任务设置分区 + 会话头角色徽标（2026-11-19）：tasks 双面包的浏览器半边——
  // 花名册含 @eterna/tasks/client.js 且 factory 注册，否则设置分区空白、徽标
  // 不渲染而宿主无任何报错。
  pass('browser roster: combo 花名册含 @eterna/tasks/client.js', roster.tasksCombo !== '',
    roster.tasksCombo === '' ? 'combo urls 无任务包条目——dsh.client 声明或 lib/client.js 缺失' : roster.tasksCombo.slice(0, 120))
  pass('browser roster: 任务包 combo 可取且含 factory 注册(id=@eterna/tasks)',
    roster.tasksBody !== '' && roster.tasksBody.includes('id: "@eterna/tasks"'),
    roster.tasksBody === '' ? 'combo 取回为空' : `bytes=${roster.tasksBody.length}`)
  // 知识底座(2026-11-19 融合):@eterna/knowledge-admin 单宿主的侧栏/工作台半边,
  // 花名册与 factory 注册双证;缺席 = 侧栏「知识库」入口静默消失。
  pass('browser roster: combo 花名册含 @eterna/knowledge-admin/client.js', roster.knowledgeCombo !== '',
    roster.knowledgeCombo === '' ? 'combo urls 无知识底座条目——dsh.client 声明或 lib/client.js 缺失' : roster.knowledgeCombo.slice(0, 120))
  pass('browser roster: 知识底座 combo 可取且含 factory 注册(id=@eterna/knowledge-admin)',
    roster.knowledgeBody !== '' && roster.knowledgeBody.includes('id: "@eterna/knowledge-admin"'),
    roster.knowledgeBody === '' ? 'combo 取回为空' : `bytes=${roster.knowledgeBody.length}`)
}

// ---------------------------------------------------------------------------
// 4. Verdict.

console.log(`verify-eterna-super: boot ${urlLine}`)
console.log(failures.length === 0
  ? `verify-eterna-super: OK — ${snapshot.entries.length} host entries, ${presetByName.size} presets, cut rows inactive, kept rows active, super 挂载面 ${superMountRows.length} 行 active`
  : `verify-eterna-super: FAILED — ${failures.join('; ')}`)
process.exitCode = failures.length === 0 ? 0 : 1

// ---------------------------------------------------------------------------

function describe(entry) {
  return entry === undefined ? 'absent' : `${entry.enabled ? 'enabled' : 'disabled'}/${entry.fiberPhase ?? 'no-fiber'}`
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
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-eterna-super', method: 'pluginInventory/list', payload: { args: {} } }),
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
 * HTML,母本 t7-ui-check.mjs:96-110 同款）,取证 index.html 花名册与
 * @eterna/prompt-studio combo 脚本。任一步失败返回 {ok:false,error},不抛出。
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
    const knowledgeCombo = comboUrls.find((u) => u.includes('@eterna/knowledge-admin/client.js')) ?? ''
    let knowledgeBody = ''
    if (knowledgeCombo !== '') {
      const combo = await fetch(`${index.origin}/${knowledgeCombo.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) knowledgeBody = await combo.text()
    }
    // 任务客户端半边(2026-11-19):设置分区(settings.section)与会话头角色徽标
    // (conversation.session.header.utilities)——与附件/压缩同款花名册取证。
    const tasksCombo = comboUrls.find((u) => u.includes('@eterna/tasks/client.js')) ?? ''
    let tasksBody = ''
    if (tasksCombo !== '') {
      const combo = await fetch(`${index.origin}/${tasksCombo.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) tasksBody = await combo.text()
    }
    return {
      ok: true, status: page.status, html, ours, comboBody, compactionCombo, compactionBody,
      attachmentsCombo, attachmentsBody, knowledgeCombo, knowledgeBody, tasksCombo, tasksBody,
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
