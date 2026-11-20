#!/usr/bin/env node
/**
 * MCP 配置迁移（WP4-1 / 50 §3.4.1 H9，rc.5）。
 *
 * rc.5 把 MCP 系统层收口到 @deepseek-ai/dsh-mcp-manager（web-app 行，配置命名
 * 空间 = 行 id `mcp-manager`，config.servers）。本品旧卷的 MCP 配置有两处来源：
 *   1. 旧 profile patch 的 `mcp-manager.config.servers`（rc.5 早期运维手写）；
 *   2. 旧 profile patch 的 `mcp-browser` insert 行（name=@deepseek-ai/dsh-mcp-client，
 *      serverName=browser，transport/command/args/env/toolCallTimeoutMs）——
 *      companion 浏览器执行面，rc.1 时代的唯一 MCP 载体。
 * 本脚本把两处合并迁入新渲染 patch 的 mcp-manager 行（系统层）。例外：新 patch
 * 自己的独立 mcp-client 行（rc.5 模板仍保留 companion `mcp-browser` insert 行）
 * 已经承载同名 server 时不重复写入——否则会挂出第二个同 serverName 的 mcp-client
 * 实例（dsh-mcp-client 对同 scope serverName 唯一性硬校验，见
 * packages/mcp/mcp-client/src/index.ts:219-222），管理器把该子实例标 failed。
 * 旧 insert 行留在旧文件里不复活；其余模板默认逐字保留。
 *
 * 纪律（50 §3.4.1 / §5.5）：
 *   - 幂等：新 patch 已是目标 servers（或同名 server 已由独立行承载）时零写；
 *   - 备份：写前备份新 patch 为 `<new>.bak-<ts>`（0600）；
 *   - fail-closed：旧/新 patch 解析失败 → 新文件原样保留、写
 *     `<dir>/.upgrade-mcp-servers-backup.json`（0600，servers 里的凭据值脱敏为
 *     `[redacted]`——红线：凭据不落盘）并退出非 0；
 *   - 幂等：新 patch 已一致时零写；
 *   - 旧数据无 MCP 配置 → 明确空操作并打印（exit 0）。
 *
 * 用法：node migrate-mcp-servers.mjs <旧 cordis.patch.yml> <新渲染 cordis.patch.yml> [备份 JSON 路径]
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const TAG = '[migrate-mcp-servers]'

/** yaml 从 tools/packctl 的依赖树解析（容器内同仓 pnpm install 存在）；失败即 fail-closed。 */
function loadYaml() {
  const requireFromPackctl = createRequire(new URL('../../tools/packctl/package.json', import.meta.url))
  try {
    return requireFromPackctl('yaml')
  } catch (error) {
    throw new Error(`yaml 依赖不可解析（期望 tools/packctl/node_modules/yaml）:${error?.message ?? error}`)
  }
}

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/** YAML 错误只留首行 + 行列：message 后续行是 code frame（含 patch 源码/令牌值）。 */
function summarizeYamlError(error) {
  const first = String(error?.message ?? error).split('\n')[0].slice(0, 240)
  const pos = Array.isArray(error?.linePos) ? error.linePos[0] : undefined
  if (pos === undefined || /at line \d+/u.test(first)) return first
  return `${first} (line ${pos.line}, column ${pos.col})`
}

function parsePatch(text, label) {
  const { parseDocument } = loadYaml()
  const doc = parseDocument(text, { strict: false })
  if (doc.errors.length > 0) {
    throw new Error(`${label}: YAML 解析失败:${summarizeYamlError(doc.errors[0])}`)
  }
  const data = doc.toJS()
  if (!Array.isArray(data)) throw new Error(`${label}: 顶层不是补丁数组`)
  return data
}

/** 该行是否是独立 mcp-client 行（rc.1 的 mcp-browser 载体；rc.5 模板仍保留 companion 行）。 */
function isMcpClientRow(entry) {
  return (entry.id === 'mcp-browser' || entry.name === '@deepseek-ai/dsh-mcp-client') && isRecord(entry.config)
}

/** 从旧 patch 收集 mcp-manager.config.servers 与 mcp-browser（dsh-mcp-client）行。 */
export function collectLegacyServers(entries) {
  const servers = {}
  const walk = list => {
    for (const entry of list) {
      if (!isRecord(entry)) continue
      if (entry.id === 'mcp-manager' && isRecord(entry.config) && isRecord(entry.config.servers)) {
        Object.assign(servers, entry.config.servers)
      }
      if (isMcpClientRow(entry)) {
        const config = entry.config
        const name = typeof config.serverName === 'string' && config.serverName.trim() !== ''
          ? config.serverName
          : 'browser'
        if (servers[name] === undefined) {
          const transport = config.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
          const converted = { transport }
          if (transport === 'stdio') {
            converted.command = typeof config.command === 'string' ? config.command : ''
            converted.args = Array.isArray(config.args) ? config.args : []
            converted.env = isRecord(config.env) ? config.env : {}
            if (typeof config.cwd === 'string' && config.cwd !== '') converted.cwd = config.cwd
          } else {
            converted.url = typeof config.url === 'string' ? config.url : ''
            converted.headers = isRecord(config.headers) ? config.headers : {}
          }
          if (typeof config.toolCallTimeoutMs === 'number') {
            converted.toolCallTimeoutMs = config.toolCallTimeoutMs
          }
          servers[name] = converted
        }
      }
      if (Array.isArray(entry.config)) walk(entry.config)
      if (Array.isArray(entry.insert)) walk(entry.insert)
    }
  }
  walk(entries)
  return servers
}

/** 只读 mcp-manager.config.servers（系统层目标表的当前值）。 */
export function collectManagerServers(entries) {
  const servers = {}
  const walk = list => {
    for (const entry of list) {
      if (!isRecord(entry)) continue
      if (entry.id === 'mcp-manager' && isRecord(entry.config) && isRecord(entry.config.servers)) {
        Object.assign(servers, entry.config.servers)
      }
      if (Array.isArray(entry.config)) walk(entry.config)
      if (Array.isArray(entry.insert)) walk(entry.insert)
    }
  }
  walk(entries)
  return servers
}

/**
 * 新 patch 里由独立 mcp-client 行承载的 server 名。
 * 这些名字已在装载树里（rc.5 模板的 companion mcp-browser 行就是如此）；再写进
 * mcp-manager 会挂出第二个同 serverName 的 mcp-client 实例——dsh-mcp-client 对
 * 同一 scope 的 serverName 唯一性硬校验（packages/mcp/mcp-client/src/index.ts:219-222
 * 「serverName ... already in use by another mcp-client instance」），管理器会把该
 * 子实例标 failed。故迁移只补「新 patch 没有行承载」的条目。
 */
export function collectRowServerNames(entries) {
  const names = new Set()
  const walk = list => {
    for (const entry of list) {
      if (!isRecord(entry)) continue
      if (isMcpClientRow(entry)) {
        names.add(typeof entry.config.serverName === 'string' && entry.config.serverName.trim() !== ''
          ? entry.config.serverName
          : 'browser')
      }
      if (Array.isArray(entry.config)) walk(entry.config)
      if (Array.isArray(entry.insert)) walk(entry.insert)
    }
  }
  walk(entries)
  return names
}

const SECRET_KEY = /token|secret|passw|credential|api[-_]?key|authorization|cookie/iu

/** 留痕 JSON 脱敏：坏配置备份只留结构与键名，凭据值不落盘（红线：凭据不落盘）。 */
export function redactServers(servers) {
  const redactValue = (key, value) => (SECRET_KEY.test(key) ? '[redacted]' : value)
  const redactUrl = url => url.replace(/\/\/[^/@\s]+:[^/@\s]+@/u, '//[redacted]@')
  const out = {}
  for (const [name, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) { out[name] = entry; continue }
    const copy = { ...entry }
    if (isRecord(copy.env)) copy.env = Object.fromEntries(Object.entries(copy.env).map(([key, value]) => [key, redactValue(key, value)]))
    if (isRecord(copy.headers)) copy.headers = Object.fromEntries(Object.entries(copy.headers).map(([key, value]) => [key, redactValue(key, value)]))
    if (typeof copy.url === 'string') copy.url = redactUrl(copy.url)
    if (Array.isArray(copy.args)) {
      const args = [...copy.args]
      for (let index = 0; index < args.length; index++) {
        const arg = args[index]
        if (typeof arg !== 'string') continue
        const flag = /^--?([^=]+)=(.*)$/u.exec(arg)
        if (flag !== null && SECRET_KEY.test(flag[1])) {
          args[index] = `${arg.slice(0, arg.length - flag[2].length)}[redacted]`
        } else if (SECRET_KEY.test(arg) && index + 1 < args.length) {
          args[index + 1] = '[redacted]'
        }
      }
      copy.args = args
    }
    out[name] = copy
  }
  return out
}

/** 定位顶层行块 [start,end)（col-0 `- id: <id>` 起，到下一 col-0 `- `）。 */
function blockSpan(lines, id) {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (start >= 0 && /^- /.test(lines[i])) return { start, end: i }
    if (start < 0 && new RegExp(`^- id: ${id}\\s*$`).test(lines[i])) start = i
  }
  return start >= 0 ? { start, end: lines.length } : undefined
}

/**
 * 在 mcp-manager 块内把 config.servers 的值替换成 servers。
 * 返回新文本；结构定位失败抛错（fail-closed）。
 */
export function writeServersIntoPatch(text, servers) {
  const { stringify } = loadYaml()
  const lines = text.split('\n')
  const span = blockSpan(lines, 'mcp-manager')
  if (span === undefined) throw new Error('新 patch 无顶层 mcp-manager 行（模板不匹配）')
  let keyIndex = -1
  let keyIndent = 0
  for (let i = span.start + 1; i < span.end; i++) {
    const match = /^(\s*)servers:\s*(.*)$/.exec(lines[i])
    if (match !== null) {
      keyIndex = i
      keyIndent = match[1].length
      break
    }
  }
  const empty = Object.keys(servers).length === 0
  const block = empty
    ? [`${' '.repeat(keyIndent)}servers: {}`]
    : [
        `${' '.repeat(keyIndent)}servers:`,
        ...stringify(servers, { indent: 2 }).replace(/\n+$/u, '').split('\n').map(line => `${' '.repeat(keyIndent + 2)}${line}`),
      ]
  if (keyIndex >= 0) {
    let end = keyIndex + 1
    while (end < span.end) {
      const line = lines[end]
      if (line.trim() === '') break
      const indent = (/^( *)/.exec(line)?.[1] ?? '').length
      if (indent <= keyIndent) break
      end++
    }
    lines.splice(keyIndex, end - keyIndex, ...block)
  } else {
    // 模板缺口兜底：在 config: 行后插入 servers（仍 fail-closed 语义之外的最小修复）。
    let configIndex = -1
    for (let i = span.start + 1; i < span.end; i++) {
      if (/^(\s*)config:\s*$/.test(lines[i])) {
        configIndex = i
        keyIndent = (/^( *)/.exec(lines[i])?.[1] ?? '').length + 2
        break
      }
    }
    if (configIndex < 0) throw new Error('mcp-manager 行无 config: 键，无法写入 servers')
    lines.splice(configIndex + 1, 0, ...block)
  }
  return lines.join('\n')
}

function writeBackupJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* 非 POSIX 卷忽略 */ }
}

/**
 * 迁移主体（测试用临时目录）。
 * @returns {{ok:boolean, error?:string, servers?:object, count?:number, wrote?:boolean, backup?:string, noop?:string, backupJson?:string, skippedRowCarriers?:string[], after?:number}}
 */
export function migrateMcpServers({ oldPatchPath, newPatchPath, backupJsonPath }) {
  const backupJson = backupJsonPath ?? join(dirname(newPatchPath), '.upgrade-mcp-servers-backup.json')
  if (!existsSync(oldPatchPath)) {
    return { ok: true, noop: `旧 patch 不存在(${oldPatchPath})，空操作` }
  }
  let oldServers
  try {
    oldServers = collectLegacyServers(parsePatch(readFileSync(oldPatchPath, 'utf8'), oldPatchPath))
  } catch (error) {
    const message = error?.message ?? String(error)
    writeBackupJson(backupJson, { capturedAt: new Date().toISOString(), source: oldPatchPath, error: message, servers: null })
    return { ok: false, error: message, backupJson }
  }
  const count = Object.keys(oldServers).length
  if (count === 0) {
    return { ok: true, noop: `旧 patch 无 MCP 配置（mcp-manager.config.servers / mcp-browser 均缺失），空操作` }
  }

  let newText
  let data
  try {
    newText = readFileSync(newPatchPath, 'utf8')
    data = parsePatch(newText, newPatchPath)
  } catch (error) {
    const message = error?.message ?? String(error)
    writeBackupJson(backupJson, { capturedAt: new Date().toISOString(), source: oldPatchPath, error: message, servers: redactServers(oldServers) })
    return { ok: false, error: message, servers: oldServers, count, backupJson }
  }

  // 新 patch 独立的 mcp-client 行（rc.5 模板的 companion mcp-browser）已承载同名
  // server；再写进 mcp-manager 会双实例同 serverName（见 collectRowServerNames 注）。
  const rowCarriers = collectRowServerNames(data)
  const skippedRowCarriers = Object.keys(oldServers).filter(name => rowCarriers.has(name))
  const current = collectManagerServers(data)
  // 合并语义（50 §3.4.1「写回同一行，保留其余模板默认」）：模板默认 + 旧表，
  // 旧表同键覆盖模板默认；独立 mcp-client 行承载的名字一律剔除。
  const target = { ...current, ...oldServers }
  for (const name of rowCarriers) delete target[name]

  if (isDeepStrictEqual(current, target)) {
    if (skippedRowCarriers.length > 0) {
      return {
        ok: true,
        servers: target,
        count: Object.keys(target).length,
        wrote: false,
        skippedRowCarriers,
        noop: `新 patch 自带 mcp-client 行承载 ${skippedRowCarriers.join(', ')}，跳过系统层迁移（避免 serverName 双实例）；无其它待迁移项，零写`,
      }
    }
    return { ok: true, servers: target, count: Object.keys(target).length, wrote: false }
  }

  let nextText
  try {
    nextText = writeServersIntoPatch(newText, target)
  } catch (error) {
    const message = error?.message ?? String(error)
    writeBackupJson(backupJson, { capturedAt: new Date().toISOString(), source: oldPatchPath, error: message, servers: redactServers(oldServers) })
    return { ok: false, error: message, servers: target, count, backupJson }
  }
  const backup = `${newPatchPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  copyFileSync(newPatchPath, backup)
  try { chmodSync(backup, 0o600) } catch { /* 非 POSIX 卷忽略 */ }
  writeFileSync(newPatchPath, nextText)
  const after = Object.keys(collectManagerServers(parsePatch(nextText, newPatchPath))).length
  return { ok: true, servers: target, count: Object.keys(target).length, wrote: true, backup, after, skippedRowCarriers }
}

function main() {
  const [oldPatchPath, newPatchPath, backupJsonPath] = process.argv.slice(2)
  if (oldPatchPath === undefined || newPatchPath === undefined) {
    console.error(`${TAG}: 用法: migrate-mcp-servers.mjs <旧 cordis.patch.yml> <新渲染 cordis.patch.yml> [备份 JSON 路径]`)
    process.exit(1)
  }
  const result = migrateMcpServers({ oldPatchPath, newPatchPath, backupJsonPath })
  if (!result.ok) {
    console.error(`${TAG}: 失败（fail-closed，新 patch 保留原样）: ${result.error}`)
    if (result.backupJson !== undefined) console.error(`${TAG}: 备份 JSON: ${result.backupJson}`)
    process.exit(1)
  }
  if (result.noop !== undefined) {
    console.log(`${TAG}: ${result.noop}`)
    return
  }
  if (result.wrote !== true) {
    console.log(`${TAG}: servers 已一致（${result.count} 项），幂等零写`)
    return
  }
  console.log(`${TAG}: 迁移 ${result.count} 项 servers 到 mcp-manager（写后 ${result.after}）| 备份: ${result.backup}`)
  if (Array.isArray(result.skippedRowCarriers) && result.skippedRowCarriers.length > 0) {
    console.log(`${TAG}: 新 patch 行已承载 ${result.skippedRowCarriers.join(', ')}，未复制到 mcp-manager（避免 serverName 双实例）`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()