/**
 * migrate-profile-bundles.mjs 单测（WP2-3 / 50 §5.5）：
 *   旧→新追加、opt-out 不回加、幂等、坏 JSON fail-closed。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateProfileBundles } from './migrate-profile-bundles.mjs'

const POSIX = process.platform !== 'win32'
const mode = path => statSync(path).mode & 0o777

const TEMPLATE = {
  name: 'dsh-profile-eterna-web',
  private: true,
  dsh: {
    profile: {
      bundles: [
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
        '@deepseek-ai/dsh-deepseek-chat-import',
        '@deepseek-ai/dsh-experimental-session-search',
        '@deepseek-ai/dsh-experimental-plugin-market-bundle',
        '@deepseek-ai/dsh-experimental-terminal-bundle',
      ],
    },
  },
}

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'eterna-bundles-'))
  const templatePath = join(dir, 'package.template.json')
  const profilePath = join(dir, 'package.json')
  const markerPath = join(dir, '.eterna-default-bundles.json')
  writeFileSync(templatePath, `${JSON.stringify(TEMPLATE, null, 2)}\n`)
  return { dir, templatePath, profilePath, markerPath }
}

function writeProfile(path, bundles) {
  writeFileSync(path, `${JSON.stringify({ name: 'dsh-profile-eterna-web', private: true, dsh: { profile: { bundles } } }, null, 2)}\n`)
}

const readBundles = path => JSON.parse(readFileSync(path, 'utf8')).dsh.profile.bundles

test('旧清单 → 新默认集：只追加缺失项并按模板顺序落位', () => {
  const w = workspace()
  writeProfile(w.profilePath, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const result = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(result.ok, true)
  assert.deepEqual(result.appended, TEMPLATE.dsh.profile.bundles.slice(2))
  assert.deepEqual(readBundles(w.profilePath), TEMPLATE.dsh.profile.bundles)
  assert.match(result.backup ?? '', /package\.json\.bak-/)
  assert.equal(readdirSync(w.dir).some(name => /package\.json\.bak-/.test(name)), true)
})

test('opt-out：marker 已记录且用户从清单移除的默认项不回加', () => {
  const w = workspace()
  writeProfile(w.profilePath, TEMPLATE.dsh.profile.bundles)
  migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  // 用户关闭 terminal bundle（从清单移除，与插件页 opt-out 等价）。
  const without = TEMPLATE.dsh.profile.bundles.filter(bundle => !bundle.includes('terminal'))
  writeProfile(w.profilePath, without)
  const result = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(result.ok, true)
  assert.deepEqual(result.optedOut, ['@deepseek-ai/dsh-experimental-terminal-bundle'])
  assert.deepEqual(result.appended, [])
  assert.deepEqual(readBundles(w.profilePath), without)
})

test('幂等：二次运行零追加、且 marker/清单字节不变', () => {
  const w = workspace()
  writeProfile(w.profilePath, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const first = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(first.wrote, true)
  const manifestAfterFirst = readFileSync(w.profilePath, 'utf8')
  const markerAfterFirst = readFileSync(w.markerPath, 'utf8')
  const second = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(second.ok, true)
  assert.deepEqual(second.appended, [])
  assert.equal(second.wrote, false)
  assert.equal(readFileSync(w.profilePath, 'utf8'), manifestAfterFirst)
  assert.equal(readFileSync(w.markerPath, 'utf8'), markerAfterFirst)
})

test('坏 JSON fail-closed：旧文件保留、留痕 JSON（0600）、不写 marker', () => {
  const w = workspace()
  writeFileSync(w.profilePath, '{ this is not json')
  const before = readFileSync(w.profilePath, 'utf8')
  const result = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /JSON 解析失败/)
  assert.equal(readFileSync(w.profilePath, 'utf8'), before)
  assert.equal(readdirSync(w.dir).some(name => name === '.eterna-default-bundles.json'), false)
  assert.equal(readdirSync(w.dir).some(name => /package\.json\.bak-/.test(name)), false)
  assert.equal(existsSync(result.backupJson ?? ''), true)
  const backup = JSON.parse(readFileSync(result.backupJson, 'utf8'))
  assert.match(backup.error, /JSON 解析失败/)
  assert.equal(backup.profileBundles, null)
  assert.equal(backup.profilePath, w.profilePath)
  if (POSIX) assert.equal(mode(result.backupJson), 0o600, '失败留痕必须 0600')
})

test('坏 JSON 留痕不落 manifest 原文（依赖 URL 里的凭据不落盘）', () => {
  const w = workspace()
  const secret = 'topsecret-9f8e7d'
  writeFileSync(w.profilePath, `{"name":"x","dependencies":{"evil":"https://user:${secret}@registry.example/pkg"},"dsh":`)
  const result = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(result.ok, false)
  const text = readFileSync(result.backupJson, 'utf8')
  assert.doesNotMatch(text, new RegExp(secret, 'u'))
})

test('成功迁移不产生失败留痕 JSON（0600 只在失败路径）', () => {
  const w = workspace()
  writeProfile(w.profilePath, ['@deepseek-ai/dsh-base'])
  const result = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(result.ok, true)
  assert.equal(existsSync(join(w.dir, '.upgrade-profile-bundles-backup.json')), false)
})

test('旧清单缺 bundles 键：按空清单补齐全部默认项（不猜其它键）', () => {
  const w = workspace()
  writeFileSync(w.profilePath, `${JSON.stringify({ name: 'dsh-profile-eterna-web', private: true }, null, 2)}\n`)
  const result = migrateProfileBundles({ profilePath: w.profilePath, templatePath: w.templatePath, markerPath: w.markerPath })
  assert.equal(result.ok, true)
  assert.deepEqual(readBundles(w.profilePath), TEMPLATE.dsh.profile.bundles)
})