#!/usr/bin/env node
/**
 * 运行态目录不得入库 —— 仓库卫生门禁。
 *
 * 起因（2026-11-19 事故）：一个提交把仓库根的 T7 隔离宿主 home
 * （`.eterna-super-home/`）连同 25 个文件一并提交，其中：
 *   - `.credentials.yaml`：授予 secret（明文）
 *   - `access/secret.key`：32 字节 HMAC 会话签名钥
 *   - `access/users.db`：账号库
 *   - `sessions/**.zstd`：完整会话记录
 * 仓库是 PUBLIC，这批东西被推到远端；同时 CI 检出后权限落成 644，
 * `@deepseek-ai/dsh-credentials-local` 的 assertOwnerOnly 拒绝启动，
 * G1-2 真启动门禁跟着红。
 *
 * 本脚本只看「索引里有没有」，不看工作区：本地跑测试生成 home 是正常的，
 * 被 `git add` 进来才是事故。
 *
 * 用法：node scripts/lint-no-runtime-home.mjs
 * 退出码 0 = 干净；1 = 有运行态文件被跟踪。
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/** 这些前缀下的任何文件都不该出现在 git 索引里（DSH_HOME 语义的运行态）。 */
const FORBIDDEN_PREFIXES = [
  '.eterna-super-home/',
  '.eterna-home',
  '.eterna-gate-home',
  '.basis-home',
]

/** 无论路径在哪，这些文件名本身就是凭据/密钥，永不入库。 */
const FORBIDDEN_BASENAMES = [
  '.credentials.yaml',
  'secret.key',
  '.env',
  '.secrets',
]

function listTracked() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    return out.split('\0').filter((line) => line !== '')
  } catch (err) {
    console.error('lint-no-runtime-home: 无法读取 git 索引（不是 git 仓库？）')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(2)
  }
}

const tracked = listTracked()

const offenders = []
for (const path of tracked) {
  const base = path.split('/').pop() ?? path
  const inRuntimeHome = FORBIDDEN_PREFIXES.some(
    (prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix),
  )
  // .env / .secrets 允许 .example 之类的模板，其余一律拦。
  const isSecretFile = FORBIDDEN_BASENAMES.includes(base)
  if (inRuntimeHome || isSecretFile) offenders.push({ path, inRuntimeHome, isSecretFile })
}

if (offenders.length === 0) {
  console.log(`运行态目录检查通过：${tracked.length} 个跟踪文件，无 DSH_HOME / 凭据文件入库。`)
  process.exit(0)
}

console.error(`运行态目录检查失败：${offenders.length} 个不该入库的文件被 git 跟踪\n`)
for (const item of offenders.slice(0, 40)) {
  const why = item.inRuntimeHome ? 'DSH_HOME 运行态目录' : '凭据文件名'
  console.error(`  ${item.path}    (${why})`)
}
if (offenders.length > 40) console.error(`  ... 另有 ${offenders.length - 40} 个`)
console.error(`
处置：
  git rm -r --cached <path>
  并确认 .gitignore 覆盖该目录（DSH_HOME 语义的运行态一律不进库）。

若凭据已经推到远端，仅删文件是不够的——必须轮换该凭据，
因为历史提交里仍可取回。
`)
process.exit(1)
