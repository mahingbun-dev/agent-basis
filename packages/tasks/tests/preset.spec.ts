/**
 * preset 声明用例(35 号 A25 验收门禁「tests/preset.spec.ts」;34 号 §4-E bundle-patch 承接行
 * 「bundle-patch → packages/tasks/tests/preset.spec.ts」;28 号 §3/§4)。
 *
 * 门禁面(33 号 §1.3 G2-A17 与 §6「压缩组挂载」行,原文拆解):
 * - orchestrator/worker 两组 preset 结构(- insert: 两行 @deepseek-ai/dsh-agent-preset,
 *   config.id 与 src/session/presets.ts 常量交叉钉住——双侧字符串漂移即红);
 * - 压缩组四件套行序不可调换:stale-tool-result-pruner → compaction-basic →
 *   command-compact → tool-result-pruner(28 号 §3 YAML 原文照搬;§4-2 行序保留:
 *   agent/pre-step 先于摘要层泄压,22 号 §4-C6,调换即白烧一次摘要模型调用);
 * - isolate 三键 compaction/toolResultPruner/staleToolResultPruner(28 号 §3;
 *   stale 为本仓 fork 增件,上游 SA 只有两键);
 * - 上游 compaction 行不挂载:全文件无 '@deepseek-ai/dsh-compaction' 引用(B6:生产已
 *   替换、上游从未挂载;22b embed 探针「上游行 disabled: true」的 preset 层对应面——
 *   本包 preset 的 compaction-basic 行 name 即 '@eterna/compaction/basic-plugin',
 *   上游行在本 preset 中不存在而非 disabled,两种形态都等价于「不挂载」);
 * - 压缩组参数与生产(eterna-web profile 同组)一致:stale(5/4096/0.7)、pruner
 *   (8192/4096/1024)、basic 沿用默认参不覆写(28 号 §2.2);
 * - C5 摘要分档键落位(24a C5;33 号 G2-A17):orchestrator 的 compaction-basic 带
 *   summarizationProvider/summarizationModel 空串对(22a §4 拍板 Q1 结论 A「维持会话
 *   模型」;35 号 §12-9 分档键暂留占位),worker 不落分档键——role-models.spec.ts 承接。
 *
 * ★本文件为静态声明面用例:patch 的真实装载与行 active 断言归 super 形态真 boot 门禁
 * (node scripts/verify-eterna-super.mjs,G1-2;A25 交付原文「preset 挂载行 active 且行序
 * 正确,行序由 packctl form-check FORM001 静态看护」)。
 */
import { describe, expect, it } from 'vitest'
import { devSuperProfileText, insertRowsOf, parseRows, parseTasksPatch, superTemplateText } from './fixtures/patch.ts'
import { COMPACTION_ROW_ORDER, ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID } from '../src/session/presets.ts'

/** 解析包根 cordis.patch.yml(单真值;行序即数组序,YAML 列表保序;!!js 前处理见 fixtures/patch.ts)。 */
const rows = parseTasksPatch()
const insertBlock = rows.find(row => row.insert !== undefined)?.insert as Array<Record<string, unknown>> | undefined
const presets = (insertBlock ?? []).filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
const presetConfig = (id: string): Record<string, unknown> => {
  const row = presets.find(preset => (preset.config as Record<string, unknown>).id === id)
  expect(row, `preset ${id} 存在`).toBeDefined()
  return row!.config as Record<string, unknown>
}
/** preset 内压缩组插件行(config.plugins 中 id === 'compaction' 的 cordis:group)。 */
const compactionGroup = (id: string): { isolate: Record<string, unknown>; config: Array<Record<string, unknown>> } => {
  const plugins = presetConfig(id).plugins as Array<Record<string, unknown>>
  const group = plugins.find(plugin => plugin.id === 'compaction')
  expect(group, `${id} 压缩组存在(28 §3)`).toBeDefined()
  return group as unknown as { isolate: Record<string, unknown>; config: Array<Record<string, unknown>> }
}

describe('orchestrator/worker 双 preset 结构(34 §1 cordis.patch.yml 行)', () => {
  it('新增行走 - insert: 且恰两组 @deepseek-ai/dsh-agent-preset', () => {
    expect(insertBlock, '本包行集须为 - insert: 块(裸 id 行会被 applyPatches 丢弃,glue E2E 教训)').toBeDefined()
    expect(presets).toHaveLength(2)
  })

  it.each([
    ['orchestrator', ORCHESTRATOR_PRESET_ID, 'eterna-tasks-orchestrator-preset'],
    ['worker', WORKER_PRESET_ID, 'eterna-tasks-worker-preset'],
  ])('%s preset:config.id 与 src/session/presets.ts 常量交叉钉住(Sessions host.presets 消费面)', (_role, configId, rowId) => {
    const row = insertBlock!.find(item => item.id === rowId)
    expect(row, `行 ${rowId} 存在`).toBeDefined()
    expect((row!.config as Record<string, unknown>).id).toBe(configId)
    // preset 选择器可见性由 name/description 表达(SA 同款;UI 文案中文,AGENTS.md 铁律)。
    expect(String(presetConfig(configId).name)).toMatch(/[\u4e00-\u9fff]/)
    expect(String(presetConfig(configId).description)).toMatch(/[\u4e00-\u9fff]/)
  })

  it('两组 preset 压缩组齐备,行序 stale→basic→command→pruner 不可调换(28 §3/§4-2;G2-A17)', () => {
    for (const id of [ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID]) {
      const group = compactionGroup(id)
      expect(group.config.map(row => row.id)).toEqual([...COMPACTION_ROW_ORDER])
    }
  })

  it('isolate 三键 compaction/toolResultPruner/staleToolResultPruner(28 §3;stale 为 fork 增件)', () => {
    for (const id of [ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID]) {
      expect(compactionGroup(id).isolate).toEqual({ compaction: true, toolResultPruner: true, staleToolResultPruner: true })
    }
  })

  it('压缩组全部行 name 解析 @eterna/compaction/*,上游 dsh-compaction 不挂载(B6;28 §3)', () => {
    for (const id of [ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID]) {
      for (const row of compactionGroup(id).config) {
        expect(String(row.name), `${id}/${row.id} 行 name`).toMatch(/^@eterna\/compaction\//)
      }
    }
    // 上游 compaction-basic 从未挂载(28 号 §3 原文;22b 探针口径的 preset 层形态):
    // 结构面判定——遍历解析树,任何行的 name 值都不得指向上游 compaction 包(行 name
    // 是 DSH 装载解析的输入;注释提及不算挂载)。
    const upstreamNames: string[] = []
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) { for (const item of value) walk(item); return }
      if (typeof value === 'object' && value !== null) {
        for (const [key, item] of Object.entries(value)) {
          if (key === 'name' && typeof item === 'string' && item.startsWith('@deepseek-ai/dsh-compaction')) upstreamNames.push(item)
          walk(item)
        }
      }
    }
    walk(rows)
    expect(upstreamNames, `上游 compaction 包名的 name 值:${upstreamNames.join(', ') || '无'}`).toEqual([])
  })

  it('压缩组参数与生产同组一致(eterna-web profile 同参;basic 默认参不覆写,28 §2.2)', () => {
    for (const id of [ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID]) {
      const rowsById = new Map(compactionGroup(id).config.map(row => [String(row.id), row]))
      expect(rowsById.get('stale-tool-result-pruner')!.config).toEqual({ keepGroups: 5, minSavingsTokens: 4096, thresholdRatio: 0.7 })
      expect(rowsById.get('tool-result-pruner')!.config).toEqual({ thresholdChars: 8192, headChars: 4096, tailChars: 1024 })
    }
  })

  it('worker 的 bash-sandbox 前台命令超时行在册(SA 值 5000;35 号 §12-12 未拍板,值变更有意识)', () => {
    const plugins = presetConfig(WORKER_PRESET_ID).plugins as Array<Record<string, unknown>>
    const shellGroup = plugins.find(plugin => plugin.id === 'shell') as { config: Array<Record<string, unknown>> } | undefined
    expect(shellGroup, 'worker shell 组存在(24 §2.4 分水岭设计)').toBeDefined()
    const bash = shellGroup!.config.find(row => row.id === 'bash-sandbox') as { config: Record<string, unknown> } | undefined
    expect(bash, 'bash-sandbox 行存在').toBeDefined()
    expect(bash!.config.timeoutMs).toBe(5000)
    expect(bash!.config.maxTimeoutMs).toBe(5000)
  })
})

describe('R22 restatement:super 模板/开发档 profile ≡ 包源(40 号 S-3 纪律 2;2026-11-21 接线)', () => {
  /** 一份行集里的 tasks 双 preset 行(按 config.id 取,保持包源序)。 */
  const restatedTasksPresets = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    (insertRowsOf(rows) ?? []).filter(row => row.name === '@deepseek-ai/dsh-agent-preset'
      && [ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID].includes((row.config as Record<string, unknown> | undefined)?.id as string))
  const sourcePresets = restatedTasksPresets(parseTasksPatch())

  it('包源恰两行(前置 sanity:worker 前 orchestrator 后)', () => {
    expect(sourcePresets).toHaveLength(2)
    expect((sourcePresets[0]!.config as Record<string, unknown>).id).toBe(WORKER_PRESET_ID)
    expect((sourcePresets[1]!.config as Record<string, unknown>).id).toBe(ORCHESTRATOR_PRESET_ID)
  })

  it.each([
    ['super 容器模板', superTemplateText],
    ['开发档 super profile', devSuperProfileText],
  ])('%s 的 insert 复述与包源深等(逐字漂移即红)', (_name, text) => {
    const restated = restatedTasksPresets(parseRows(text))
    expect(restated).toHaveLength(2)
    expect(restated).toEqual(sourcePresets)
  })

  it.each([
    ['super 容器模板', superTemplateText],
    ['开发档 super profile', devSuperProfileText],
  ])('%s 的 eterna-tasks 挂载行在 preset 行之前(同一 insert 块内,R22 接线局部性)', (_name, text) => {
    const rows = insertRowsOf(parseRows(text))
    const presetAt = rows.findIndex(row => row.name === '@deepseek-ai/dsh-agent-preset'
      && (row.config as Record<string, unknown> | undefined)?.id === ORCHESTRATOR_PRESET_ID)
    const pluginAt = rows.findIndex(row => row.id === 'eterna-tasks' && row.name === '@eterna/tasks')
    expect(presetAt).toBeGreaterThan(-1)
    expect(pluginAt).toBeGreaterThan(-1)
    expect(pluginAt).toBeLessThan(presetAt)
  })
})
