/**
 * migrate-mcp-servers.mjs 单测（WP4-1 / H9）：
 *   mcp-browser 旧行 → mcp-manager.servers、旧 servers 合并、幂等、坏 YAML fail-closed、空操作。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateMcpServers } from './migrate-mcp-servers.mjs'

const POSIX = process.platform !== 'win32'
const mode = path => statSync(path).mode & 0o777

const NEW_PATCH = `# new profile patch (rc.5 template render)
- id: mcp-manager
  config:
    servers: {}

- id: agent-default-model
  config:
    provider: mimo
    model: mimo-v2.6-pro
`

const OLD_PATCH_BROWSER = `# old profile patch (rc.1 render)
- insert:
    - id: mcp-browser
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: node
        args:
          - /repo/packages/browser-relay/dist/mcp.mjs
        env:
          ETNA_RELAY_BASE: http://127.0.0.1:9310
          ETNA_RELAY_TOKEN: token-placeholder
        toolCallTimeoutMs: 120000
`

function workspace(newText = NEW_PATCH) {
  const dir = mkdtempSync(join(tmpdir(), 'eterna-mcp-'))
  const oldPatchPath = join(dir, 'old.cordis.patch.yml')
  const newPatchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(newPatchPath, newText)
  return { dir, oldPatchPath, newPatchPath }
}

test('mcp-browser 旧行 → mcp-manager.config.servers（键名取 serverName）', () => {
  const w = workspace()
  writeFileSync(w.oldPatchPath, OLD_PATCH_BROWSER)
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, true)
  assert.equal(result.wrote, true)
  assert.equal(result.count, 1)
  const text = readFileSync(w.newPatchPath, 'utf8')
  assert.match(text, /- id: mcp-manager[\s\S]*servers:\n\s+browser:\n\s+transport: stdio/)
  assert.match(text, /command: node/)
  assert.match(text, /ETNA_RELAY_TOKEN: token-placeholder/)
  assert.match(text, /toolCallTimeoutMs: 120000/)
  assert.match(text, /- id: agent-default-model/)
  assert.equal(readdirSync(w.dir).some(name => /cordis\.patch\.yml\.bak-/.test(name)), true)
})

test('旧 mcp-manager servers 与 mcp-browser 合并（同键以旧 servers 为准）', () => {
  const w = workspace()
  writeFileSync(w.oldPatchPath, `- id: mcp-manager
  config:
    servers:
      internal:
        transport: streamable-http
        url: https://mcp.internal.example/mcp
        headers:
          Authorization: Bearer token
      browser:
        transport: stdio
        command: custom
` + OLD_PATCH_BROWSER)
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  const text = readFileSync(w.newPatchPath, 'utf8')
  assert.match(text, /internal:/)
  assert.match(text, /url: https:\/\/mcp\.internal\.example\/mcp/)
  assert.match(text, /command: custom/)
  assert.doesNotMatch(text, /command: node/)
})

test('幂等：二次运行 servers 已一致 → 零写、无新备份', () => {
  const w = workspace()
  writeFileSync(w.oldPatchPath, OLD_PATCH_BROWSER)
  const first = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(first.wrote, true)
  const afterFirst = readFileSync(w.newPatchPath, 'utf8')
  const backupsAfterFirst = readdirSync(w.dir).filter(name => /cordis\.patch\.yml\.bak-/.test(name)).length
  const second = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(second.ok, true)
  assert.equal(second.wrote, false)
  assert.equal(readFileSync(w.newPatchPath, 'utf8'), afterFirst)
  assert.equal(readdirSync(w.dir).filter(name => /cordis\.patch\.yml\.bak-/.test(name)).length, backupsAfterFirst)
})

test('坏 YAML fail-closed：新 patch 原样保留、写 0600 备份 JSON、非 0 语义', () => {
  const w = workspace()
  writeFileSync(w.oldPatchPath, 'a: [unclosed\n')
  const before = readFileSync(w.newPatchPath, 'utf8')
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /YAML 解析失败/)
  assert.equal(readFileSync(w.newPatchPath, 'utf8'), before)
  assert.equal(existsSync(result.backupJson ?? ''), true)
  const backup = JSON.parse(readFileSync(result.backupJson, 'utf8'))
  assert.equal(backup.error.length > 0, true)
  assert.equal(backup.servers, null)
  if (POSIX) assert.equal(mode(result.backupJson), 0o600, '失败留痕必须 0600')
})

test('模板默认 servers 保留：旧表只覆盖同名键，不整表替换', () => {
  const w = workspace(`- id: mcp-manager
  config:
    servers:
      template-default:
        transport: streamable-http
        url: https://template.example/mcp
      shared:
        transport: stdio
        command: template-cmd
`)
  writeFileSync(w.oldPatchPath, `- id: mcp-manager
  config:
    servers:
      shared:
        transport: stdio
        command: legacy-cmd
      legacy-only:
        transport: stdio
        command: legacy
`)
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, true)
  assert.equal(result.wrote, true)
  assert.equal(result.count, 3)
  const text = readFileSync(w.newPatchPath, 'utf8')
  assert.match(text, /template-default:/)
  assert.match(text, /url: https:\/\/template\.example\/mcp/)
  assert.match(text, /legacy-only:/)
  assert.match(text, /command: legacy-cmd/)
  assert.doesNotMatch(text, /command: template-cmd/)
})

test('旧 patch 无 MCP 配置 → 明确空操作（exit 0 语义）', () => {
  const w = workspace()
  writeFileSync(w.oldPatchPath, '- id: preset-standard\n  config:\n    id: standard\n')
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, true)
  assert.match(result.noop ?? '', /无 MCP 配置/)
  assert.equal(readFileSync(w.newPatchPath, 'utf8'), NEW_PATCH)
})

test('旧 patch 不存在 → 空操作', () => {
  const w = workspace()
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, true)
  assert.match(result.noop ?? '', /不存在/)
})

test('新 patch 缺 mcp-manager 行 → fail-closed，新文件不写', () => {
  const w = workspace('- id: preset-standard\n  config:\n    id: standard\n')
  writeFileSync(w.oldPatchPath, OLD_PATCH_BROWSER)
  const before = readFileSync(w.newPatchPath, 'utf8')
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /无顶层 mcp-manager 行/)
  assert.equal(readFileSync(w.newPatchPath, 'utf8'), before)
})

test('新 patch 自带同名 mcp-client 行 → 不重复写入 mcp-manager（serverName 双实例防护）', () => {
  const w = workspace(`${NEW_PATCH}
- insert:
    - id: mcp-browser
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: node
        args:
          - /repo/packages/browser-relay/dist/mcp.mjs
        env:
          ETNA_RELAY_TOKEN: __ETERNA_RELAY_TOKEN__
`)
  writeFileSync(w.oldPatchPath, OLD_PATCH_BROWSER)
  const before = readFileSync(w.newPatchPath, 'utf8')
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, true)
  assert.equal(result.wrote, false)
  assert.deepEqual(result.skippedRowCarriers, ['browser'])
  assert.match(result.noop ?? '', /跳过系统层迁移/u)
  assert.equal(readFileSync(w.newPatchPath, 'utf8'), before)
})

test('新 patch 行承载 browser 时，旧 manager 的其它 server 仍迁移', () => {
  const w = workspace(`${NEW_PATCH}
- insert:
    - id: mcp-browser
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: node
`)
  writeFileSync(w.oldPatchPath, `- id: mcp-manager
  config:
    servers:
      internal:
        transport: streamable-http
        url: https://mcp.internal.example/mcp
` + OLD_PATCH_BROWSER)
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, true)
  assert.equal(result.wrote, true)
  assert.equal(result.count, 1)
  assert.deepEqual(result.skippedRowCarriers, ['browser'])
  const text = readFileSync(w.newPatchPath, 'utf8')
  assert.match(text, /internal:/)
  assert.doesNotMatch(text, /servers:\n\s+browser:/u)
})

test('失败留痕 JSON 脱敏：servers 里的令牌/密钥值不落盘', () => {
  const w = workspace('a: [unclosed\n')
  writeFileSync(w.oldPatchPath, OLD_PATCH_BROWSER)
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, false)
  const backup = JSON.parse(readFileSync(result.backupJson, 'utf8'))
  assert.equal(backup.servers.browser.env.ETNA_RELAY_TOKEN, '[redacted]')
  assert.equal(backup.servers.browser.env.ETNA_RELAY_BASE, 'http://127.0.0.1:9310')
  assert.doesNotMatch(JSON.stringify(backup), /token-placeholder/u)
})

test('坏 YAML 报错不打印 code frame（旧 patch 内令牌不落日志/留痕）', () => {
  const w = workspace()
  const secret = 'rl-do-not-log-0123456789'
  writeFileSync(w.oldPatchPath, `- id: mcp-browser
  config:
    env:
      ETNA_RELAY_TOKEN: ${secret}
    broken: [unclosed
`)
  const result = migrateMcpServers({ oldPatchPath: w.oldPatchPath, newPatchPath: w.newPatchPath })
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.error ?? '', new RegExp(secret, 'u'))
  const backupText = readFileSync(result.backupJson, 'utf8')
  assert.doesNotMatch(backupText, new RegExp(secret, 'u'))
  assert.match(backupText, /YAML 解析失败/u)
})