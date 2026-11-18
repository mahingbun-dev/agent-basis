#!/usr/bin/env node
/**
 * 本地 super 开发实例预热（2026-11-18）：与容器构建语义对齐的本地版三步——
 * ① peer 对齐：@deepseek-ai/* 的 catalog: peer → "*"（Dockerfile:30-32 同款，
 *    仅声明面；实测该文件不被 pnpm 锁校验阻拦，改动即本地生效）；
 * ② 逐包构建：含 build-client.mjs 的包 + llm-openai tsc（Dockerfile:37-39 同款）；
 * ③ symlink/物化：交给 verify-eterna-super.mjs（已改用容器模板为 patch 源）。
 * 用法：node scripts/dev-prewarm-super.mjs && ETERNA_PROFILE_HOME=/tmp/eterna-super-dev node scripts/verify-eterna-super.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let aligned = 0
for (const p of readdirSync(join(repoRoot, 'packages'))) {
  const f = join(repoRoot, 'packages', p, 'package.json')
  if (!existsSync(f)) continue
  const j = JSON.parse(readFileSync(f, 'utf8'))
  // 只对齐 peerDependencies（镜像 Dockerfile:30-32 严格同款）：dsh exact-version
  // 校验读 peer；dependencies 的 catalog: 是 pnpm workspace 特性、Node import 不读
  // 版本，改了反而破坏私有包解析（2026-11-18 教训：@deepseek-ai/dsh-compact → * 404）。
  let changed = false
  const deps = j.peerDependencies
  if (deps) {
    for (const k of Object.keys(deps)) {
      if (k.startsWith('@deepseek-ai/') && deps[k] !== '*') { deps[k] = '*'; changed = true }
    }
  }
  if (changed) { writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); aligned++ }
}
console.log(`[prewarm] peer 对齐: ${aligned} 包 catalog: → *`)
const clientPkgs = readdirSync(join(repoRoot, 'packages')).filter((p) => existsSync(join(repoRoot, 'packages', p, 'scripts', 'build-client.mjs')))
for (const p of clientPkgs) {
  const r = spawnSync('node', [join(repoRoot, 'packages', p, 'scripts', 'build-client.mjs')], { cwd: join(repoRoot, 'packages', p), stdio: 'pipe' })
  console.log(`[prewarm] build-client ${p}: ${r.status === 0 ? 'ok' : 'FAIL ' + String(r.stderr).slice(0, 200)}`)
}
const relay = spawnSync('node', ['build.mjs'], { cwd: join(repoRoot, 'packages', 'browser-relay'), stdio: 'pipe' })
console.log(`[prewarm] browser-relay: ${relay.status === 0 ? 'ok' : 'FAIL'}`)
const llmo = spawnSync('./node_modules/.bin/tsc', ['-p', 'tsconfig.build.json'], { cwd: join(repoRoot, 'packages', 'llm-openai'), stdio: 'pipe' })
console.log(`[prewarm] llm-openai tsc: ${llmo.status === 0 ? 'ok' : 'FAIL'}`)
