/**
 * skills 插件(systemPrompt catalog + `skill` 工具)。
 *
 * 为什么 catalog 走 systemPrompt section 而不是 pre-step:
 * loop 每 step 的 pre-step 草稿是 `messages` 的副本,写回不会留存;若只在首 step
 * 注入,后续 step 的模型请求就看不到目录。system prompt 每 turn 只装配一次且
 * 随 `messages[0]` 保留到所有 step,正好满足「目录只注入一次、全程可见」。
 * (StepDraft 已补 agent/signal,留给后续需要按 turn 状态注入的插件。)
 *
 * 工具名固定 `skill`;模型先看 `<available_skills>` 再按 name 加载正文。
 * 资源文件只列相对路径与目录基准,由模型用宿主工具自行读取(本包不内建读文件)。
 */
import type { Context } from '@core/cordis'
import { defineTool } from '@core/contracts'
import {
  DEFAULT_MAX_SKILL_BYTES, DEFAULT_MAX_SKILLS, DEFAULT_SKILL_DIRS,
  readSkillContent, renderSkillCatalog, renderSkillContent, scanSkills,
  type SkillEntry, type SkillScanOptions, type SkillScanResult,
} from './store.ts'

export const SKILLS_PLUGIN_NAME = 'basis-skills'
/** system prompt section 名(唯一)。 */
export const SKILLS_SECTION_NAME = 'basis-skills'
/** 工具名(与上游 dsh-tool-skill 的可发现入口同名,便于 prompt 迁移)。 */
export const SKILL_TOOL_NAME = 'skill'

export interface SkillsPluginConfig {
  readonly dirs?: readonly string[] | undefined
  readonly cwd?: string | undefined
  readonly maxSkills?: number | undefined
  readonly maxSkillBytes?: number | undefined
}

/** ctx.skills 服务面(basis 内其他插件/测试可查目录与加载)。 */
export interface BasisSkillsService {
  scan(): SkillScanResult
  /** 完整 system prompt 目录;无技能为空串。 */
  catalog(): string
  /** 按名加载正文;不存在或格式坏了抛错。 */
  load(name: string): { readonly entry: SkillEntry; readonly content: string }
}

interface SkillToolValue {
  readonly name: string
  readonly content: string
  readonly dir: string
  readonly resources: readonly string[]
}

export function createSkillsService(options: SkillScanOptions): BasisSkillsService {
  const scan = (): SkillScanResult => scanSkills(options)
  return {
    scan,
    catalog: () => renderSkillCatalog(scan().entries),
    load(name: string) {
      const result = scan()
      const entry = result.entries.find(row => row.name === name)
      if (entry === undefined) {
        const names = result.entries.map(row => row.name)
        throw new Error(`技能 ${name} 不存在或不可用${names.length === 0 ? '' : `(可用:${names.join(', ')})`}`)
      }
      return { entry, content: readSkillContent(entry, options.maxSkillBytes ?? DEFAULT_MAX_SKILL_BYTES) }
    },
  }
}

export function defineSkillsPlugin(config: SkillsPluginConfig = {}) {
  return {
    name: SKILLS_PLUGIN_NAME,
    inject: { tools: true, systemPrompt: true } as never,
    apply(ctx: Context): () => void {
      const options: SkillScanOptions = {
        ...(config.dirs === undefined ? { dirs: DEFAULT_SKILL_DIRS } : { dirs: config.dirs }),
        ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
        maxSkills: config.maxSkills ?? DEFAULT_MAX_SKILLS,
        maxSkillBytes: config.maxSkillBytes ?? DEFAULT_MAX_SKILL_BYTES,
      }
      const service = createSkillsService(options)
      const disposeSection = ctx.systemPrompt.section({
        name: SKILLS_SECTION_NAME,
        order: 300,
        text: () => service.catalog(),
      })
      const disposeTool = ctx.tools.register(defineTool({
        name: SKILL_TOOL_NAME,
        description:
          '加载一个技能的完整指令。先看 system prompt 里的 <available_skills> 目录;'
          + '只有当任务与某个技能描述匹配时才调用,name 必须取目录中的名称。'
          + '返回 <skill_content> 正文与可选的资源文件路径。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名(取 <available_skills> 列表中的 name)' },
          },
          required: ['name'],
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              content: { type: 'string' },
              dir: { type: 'string' },
              resources: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'content', 'dir', 'resources'],
          },
          render: (_args, value) => {
            const result = value as SkillToolValue
            return [{
              type: 'text',
              text: renderSkillContent({
                name: result.name,
                dir: result.dir,
                resources: result.resources,
                content: result.content,
              }),
            }]
          },
        },
        execute(args, exec) {
          exec.signal.throwIfAborted()
          const name = (args as { name?: unknown }).name
          if (typeof name !== 'string' || name === '') throw new TypeError('name 必须是非空字符串')
          const { entry, content } = service.load(name)
          return Promise.resolve({ name: entry.name, content, dir: entry.dir, resources: entry.resources })
        },
      }))
      const disposeProvide = ctx.provide('skills', service)
      return () => {
        disposeProvide()
        disposeTool()
        disposeSection()
      }
    },
  }
}

export default defineSkillsPlugin()
