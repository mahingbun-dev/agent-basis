/**
 * bundle 装载:解析 manifest(yaml)→ dynamic import 各入口模块 default export
 * 插件实例 → cordis 根 Context 逐个挂载 → 等 fiber settle。
 *
 * manifest 形态(basis.yml):
 *   plugins:
 *     - packages/tools                  # 包目录(装载 <目录>/src/index.ts 的 default export)
 *     - path: packages/llm              # 对象形态可带 config
 *       config: { provider: litellm }
 *     - packs/event-planning/plugin.ts  # 以 .ts 结尾 = 直接指定模块文件
 *   agent: default                      # 默认 agent 名(可选)
 *
 * 装载纪律:任一插件 fiber 抛错 = 装载失败(已装载插件全量回卷后抛出)。
 */
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@core/cordis'
import type { Fiber, Plugin } from '@core/cordis'
import '@core/contracts'
import { parse } from 'yaml'

/** 单个 bundle 条目的规范化形态。 */
export interface BundleEntry {
  /** 入口:包目录(取 <目录>/src/index.ts)或以 .ts 结尾的模块文件;相对 manifest 所在目录。 */
  readonly path: string
  /** 传给插件的 config(经插件 Config schema 校验;无 schema 原样传入)。 */
  readonly config?: unknown
}

/** bundle 清单(basis.yml 解析产物)。 */
export interface BundleManifest {
  readonly plugins: readonly BundleEntry[]
  /** 默认 agent 名(缺省 undefined → agents.resolve 走注册的 default)。 */
  readonly agent?: string
}

/** 装载结果:根 Context、已挂 fiber 集,可整体回卷。 */
export interface BootedBundle {
  readonly ctx: Context
  readonly manifest: BundleManifest
  /** 全量回卷:逐 fiber dispose(逆序由 registry 记录序保证),settle 后返回。 */
  dispose(): Promise<void>
}

/** 解析 + 校验 manifest(fail-loud:plugins 缺失/空、条目非法都抛错)。 */
export function parseManifest(raw: unknown): BundleManifest {
  if (raw === null || typeof raw !== 'object') throw new TypeError('manifest 必须是对象')
  const record = raw as Record<string, unknown>
  const pluginsRaw = record['plugins']
  if (!Array.isArray(pluginsRaw) || pluginsRaw.length === 0) {
    throw new TypeError('manifest.plugins 必须是非空数组')
  }
  const plugins: BundleEntry[] = pluginsRaw.map((entry) => {
    if (typeof entry === 'string') return { path: entry }
    if (entry !== null && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['path'] === 'string') {
      const object = entry as Record<string, unknown>
      return object['config'] !== undefined
        ? { path: object['path'] as string, config: object['config'] }
        : { path: object['path'] as string }
    }
    throw new TypeError(`manifest.plugins 条目非法:${JSON.stringify(entry)}`)
  })
  const agent = typeof record['agent'] === 'string' ? record['agent'] : undefined
  return { plugins, ...(agent !== undefined ? { agent } : {}) }
}

/** 从 yaml 文本解析 manifest。 */
export function parseManifestYaml(text: string): BundleManifest {
  return parseManifest(parse(text))
}

/** 入口路径 → 模块文件绝对路径 + file URL(目录形态补 src/index.ts)。 */
export function resolveEntryModule(entryPath: string, manifestDir: string): string {
  const base = isAbsolute(entryPath) ? entryPath : join(manifestDir, entryPath)
  const file = base.endsWith('.ts') ? base : join(base, 'src', 'index.ts')
  return pathToFileURL(file).href
}

/** 装载 bundle:逐插件挂载,任一失败则回卷已装载集合并抛错。 */
export async function bootBundle(manifest: BundleManifest, manifestDir: string): Promise<BootedBundle> {
  const ctx = new Context()
  const live: Fiber[] = []
  try {
    for (const entry of manifest.plugins) {
      const url = resolveEntryModule(entry.path, manifestDir)
      const module = await (import(url) as Promise<{ default?: unknown }>)
      const plugin = module.default
      if (plugin === null || typeof plugin !== 'object' || typeof (plugin as { apply?: unknown }).apply !== 'function') {
        throw new TypeError(`入口 ${entry.path} 的 default export 不是插件对象(缺 apply)`)
      }
      const fiber = entry.config !== undefined
        ? ctx.plugin(plugin as Plugin, entry.config)
        : ctx.plugin(plugin as Plugin)
      await fiber
      live.push(fiber)
    }
  } catch (error) {
    await disposeAll(live)
    throw error
  }
  return {
    ctx,
    manifest,
    dispose: () => disposeAll(live),
  }
}

/** 逐 fiber dispose 并 settle(装载失败回卷 / 正常退出共用;服务撤销随提供者 fiber 自动生效)。 */
async function disposeAll(live: readonly Fiber[]): Promise<void> {
  for (const fiber of live) {
    await fiber.dispose()
  }
}
