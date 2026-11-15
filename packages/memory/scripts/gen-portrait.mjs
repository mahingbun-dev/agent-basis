#!/usr/bin/env node
/**
 * 用户画像手动生成器(M-M1 T4,19 号 §3-T4):node 直跑读库生成 portrait.md。
 *
 * 交付形态(M-M1):无 UI、无定时——本脚本是画像 v0 的唯一触发入口;周期再生成与
 * 纠正入口在 M-M3(整固 job Prune 阶段复用 buildPortrait 并 bump version)。
 * 索引消费侧:glue memory-plugin 每次装配现读同目录 portrait.md 缓存注入画像区
 * (文件缺席/空正文则省略画像区,单区锚点形态)。
 *
 * 用法:node scripts/gen-portrait.mjs [记忆库路径]
 * - 记忆库缺省 = <cwd>/.eterna/memory.sqlite3(与 glue defineMemoryPlugin 缺省一致);
 * - 输出恒为与库同目录的 portrait.md(19 号 §3-T4;路径在 tenant-scan 覆盖面内);
 * - version 自 bump:读既有 portrait.md frontmatter 的 version +1,不存在从 1 起;
 * - 直接 import src/*.ts(Node ≥22 类型剥离直跑,不经构建产物)。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DomainRegistryStore } from '../src/domain.ts'
import { EntityMemoryStore } from '../src/entity-store.ts'
import { buildPortrait } from '../src/portrait.ts'

const dbPath = resolve(process.argv[2] ?? join(process.cwd(), '.eterna/memory.sqlite3'))
const portraitPath = join(dirname(dbPath), 'portrait.md')

if (!existsSync(dbPath)) {
  console.error(`[memory] 未找到记忆库:${dbPath}(请在 workspace 目录内运行,或显式传入库路径)`)
  process.exit(1)
}

const entities = new EntityMemoryStore(dbPath)
const domains = new DomainRegistryStore(dbPath)
try {
  const version = nextVersion(readExisting(portraitPath))
  const portrait = buildPortrait(entities.listLive(), { domains: domains.list(), version })
  writeFileSync(portraitPath, portrait, 'utf8')
  console.log(`[memory] 画像已生成:${portraitPath}(version ${version},来源记忆 ${countSourceIds(portrait)} 条)`)
} finally {
  entities.close()
  domains.close()
}

/** 读旧画像文本(不存在/读取失败返回 null,版本从 1 起)。 */
function readExisting(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** version bump:frontmatter `version: N` → N+1;无旧文件/无版本行 → 1。 */
function nextVersion(existing) {
  const match = existing?.match(/^version:\s*(\d+)/m)
  return match ? Number(match[1]) + 1 : 1
}

/** 从生成文本回读来源记忆条数(汇报用;口径=frontmatter source_memory_ids)。 */
function countSourceIds(portrait) {
  const match = portrait.match(/^source_memory_ids: \[([^\]]*)\]/m)
  const raw = match?.[1]?.trim()
  return raw ? raw.split(',').length : 0
}
