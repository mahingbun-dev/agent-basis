#!/usr/bin/env node
/**
 * profile 默认 bundle 迁移（50 §5.5 / WP2-3，rc.5）。
 *
 * 背景：rc.5 的默认 bundle 集从 base+web-app 扩为六项（base + web-app +
 * deepseek-chat-import + session-search + plugin-market + terminal）。存量卷上
 * profile/package.json 的 dsh.profile.bundles 由 transplant-profile.mjs 的
 * manifest 模式整体保留（用户选择跨升级持久）——新默认不会自动出现。
 * 本脚本按「只追加旧清单没有的默认项」补齐。
 *
 * marker（`.eterna-default-bundles.json`，与 profile package.json 同目录）：
 * 记录本迁移「已知的默认集」。语义：
 *   - 当前清单已含某默认项 → 记入 marker（用户以后删掉它 = opt-out，不再回加）；
 *   - 当前清单缺该项且 marker 已记 → 用户已关闭，跳过；
 *   - 当前清单缺该项且 marker 未记 → 追加（首次升级/新版本新增默认）。
 * 因此幂等：二次运行零追加；已 opt-out 项不会被「修复」回加。
 *
 * Fail-closed（50 §5.5）：旧 package.json / 新模板解析失败 → 保留旧文件、打印
 * 告警、退出非 0，由 entrypoint 决定是否继续启动（不得静默写坏文件）。同时在
 * `<profile 同目录>/.upgrade-profile-bundles-backup.json`（0600）留痕——只记
 * 路径/错误与可解析的 bundles 清单，不落 manifest 原文（依赖 URL 可能带凭据）。
 *
 * 用法：
 *   node migrate-profile-bundles.mjs <profile package.json> <新模板 package.json> [marker 路径]
 * marker 缺省 = <profile package.json 同目录>/.eterna-default-bundles.json
 * 失败留痕缺省 = <profile package.json 同目录>/.upgrade-profile-bundles-backup.json
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = '[migrate-profile-bundles]'

function writeBackupJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* 非 POSIX 卷忽略 */ }
}

/** 失败留痕只带结构：能解析就记 bundles 清单，不能解析则 null（不落 manifest 原文）。 */
function previewBundles(path) {
  try {
    return bundlesOf(JSON.parse(readFileSync(path, 'utf8'))) ?? null
  } catch {
    return null
  }
}

function readJson(path) {
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${path}: JSON 解析失败(${error?.message ?? error})`)
  }
}

function bundlesOf(manifest) {
  const list = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(list) || !list.every(item => typeof item === 'string')) {
    return undefined
  }
  return list
}

/**
 * 迁移主体（纯函数式：读写路径显式传入，测试用临时目录）。
 * @returns {{ok:boolean, error?:string, appended:string[], kept:string[], optedOut:string[], backup?:string, wrote:boolean, backupJson?:string}}
 */
export function migrateProfileBundles({ profilePath, templatePath, markerPath, backupJsonPath }) {
  const backupJson = backupJsonPath ?? join(dirname(profilePath), '.upgrade-profile-bundles-backup.json')
  const fail = (message, { profileBundles = null } = {}) => {
    console.error(`${TAG}: ERROR ${message}`)
    writeBackupJson(backupJson, {
      capturedAt: new Date().toISOString(),
      profilePath,
      templatePath,
      error: message,
      profileBundles,
    })
    return { ok: false, error: message, backupJson }
  }
  let template
  let profile
  try {
    template = readJson(templatePath)
    profile = readJson(profilePath)
  } catch (error) {
    return fail(error?.message ?? String(error), { profileBundles: previewBundles(profilePath) })
  }
  const defaults = bundlesOf(template)
  if (defaults === undefined || defaults.length === 0) {
    return fail(`新模板 ${templatePath} 缺 dsh.profile.bundles（非空字符串数组）`, { profileBundles: previewBundles(profilePath) })
  }
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    return fail(`旧 profile ${profilePath} 顶层不是对象`)
  }
  const current = bundlesOf(profile) ?? []

  let marker
  const markerExisted = existsSync(markerPath)
  if (markerExisted) {
    try {
      marker = readJson(markerPath)
    } catch (error) {
      return fail(`marker ${markerPath} 损坏:${error?.message ?? error}`, { profileBundles: current })
    }
  }
  const known = new Set(Array.isArray(marker?.defaultBundles) ? marker.defaultBundles : [])
  const merged = [...current]
  const appended = []
  const kept = []
  const optedOut = []
  for (const bundle of defaults) {
    if (merged.includes(bundle)) {
      known.add(bundle)
      kept.push(bundle)
    } else if (known.has(bundle)) {
      optedOut.push(bundle)
    } else {
      merged.push(bundle)
      appended.push(bundle)
      known.add(bundle)
    }
  }

  const nextMarker = {
    version: 1,
    defaultBundles: [...known].sort(),
  }
  let wrote = false
  let backup
  if (appended.length > 0) {
    backup = `${profilePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(profilePath, backup)
    const next = { ...profile, dsh: { ...profile.dsh, profile: { ...profile.dsh?.profile, bundles: merged } } }
    writeFileSync(profilePath, `${JSON.stringify(next, null, 2)}\n`)
    wrote = true
  }
  // marker 只在内容变化时写（幂等：二次运行字节级零写）。
  const markerText = `${JSON.stringify(nextMarker, null, 2)}\n`
  const markerCurrent = markerExisted ? readFileSync(markerPath, 'utf8') : undefined
  if (markerCurrent !== markerText) writeFileSync(markerPath, markerText)

  return { ok: true, appended, kept, optedOut, backup, wrote }
}

function main() {
  const [profilePath, templatePath, markerArg] = process.argv.slice(2)
  if (profilePath === undefined || templatePath === undefined) {
    console.error(`${TAG}: 用法: migrate-profile-bundles.mjs <profile package.json> <新模板 package.json> [marker 路径]`)
    process.exit(1)
  }
  const markerPath = markerArg ?? join(dirname(profilePath), '.eterna-default-bundles.json')
  const result = migrateProfileBundles({ profilePath, templatePath, markerPath })
  if (!result.ok) {
    console.error(`${TAG}: 保留旧 package.json 不写（fail-closed）`)
    if (result.backupJson !== undefined) console.error(`${TAG}: 失败留痕: ${result.backupJson}`)
    process.exit(1)
  }
  if (result.appended.length === 0) {
    console.log(`${TAG}: 无新增默认 bundle（已幂等）${result.optedOut.length > 0 ? ` | 用户已 opt-out: ${result.optedOut.join(', ')}` : ''}`)
    return
  }
  console.log(`${TAG}: 追加默认 bundle: ${result.appended.join(', ')}${result.backup ? ` | 备份: ${result.backup}` : ''}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()