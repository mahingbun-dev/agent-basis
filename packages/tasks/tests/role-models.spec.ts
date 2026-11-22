/**
 * role-models 用例(35 号 A25 验收门禁「tests/role-models.spec.ts」;34 号 §4-D role-models 行
 * 「orchestrator/worker 双 preset 模型配置;★C5 主 Session 摘要档位绑定(22a 结论档)」)。
 *
 * 承接形态(34 号 §2.6 第二行「SA role-models.ts 不整体移植、preset 声明落本任务
 * cordis.patch.yml」):SA src/app/role-models.ts 的「按角色给会话播种默认模型」语义在本仓
 * 落为 SettingsSchema 的双角色模型键(A4/A10 已落地,src/policy/settings.ts):
 * - orchestrator 侧 = `eval.model`(候选评估/裁决会话的模型,SettingsSchema EvalConfig);
 * - worker 侧 = `executor.model`(工单执行会话的模型,SettingsSchema ExecutorConfig);
 * - 两者缺省 null = 不覆写、随宿主会话默认模型(与 SA initializeRoleModel 的「模型缺席即
 *   不播种」同一语义);RoleModel = provider/model/reasoningEffort 三键(严格 schema)。
 *
 * ★C5 摘要档位绑定(24a 拍板记录·C5;28 号 §4-4;33 号 G2-A17):主 Session 压缩质量直接
 * 影响分发裁决 → 摘要模型按角色分档配置。当前绑定 = 22a 结论档:22a §4 拍板 Q1 结论 A
 * 「维持会话模型,summarizationProvider/Model 不落值」——orchestrator 压缩组的
 * compaction-basic 行落 `summarizationProvider: ''`/`summarizationModel: ''` 空串对
 * (空 = 会话模型;basic/config.ts 校验二者必须成对置空或成对置值)。具体档名与成本口径
 * 见 35 号 §12-9 开放问题(分档键暂留占位,拍板后回填);分档配置改动必全量重跑压缩
 * golden:`node packages/compaction/scripts/run-golden.mjs --judge`(G2-A17,报告入库)。
 * worker 组不落分档键(28 号 §9 配置面表:分档键落位在 orchestrator 组)。
 *
 * ★53 号 D2 orchestrator 特化压缩参数(53 号 §3-D2/§4-P2):orchestrator 的
 * compaction-basic 行另落 `thresholdRatio: 0.7`(默认 0.8→0.7,与 L2 stale 层同档:
 * stale 先泄压、basic 只在泄压不足时摘要兜底)与 `attachments: true`(默认 false→true,
 * C11 附件重读,22 号 §5-C11);retainRatio/摘要模型空串对/重试次数均不动。worker 组
 * 不落 D2 特化键(保持默认参)。初值即候选值,正式值以 P2 双门禁为准——压缩 golden
 * userVerbatim 召回 100%(22 号 :185 门槛基线)+ 路由金集压缩态回放通过率差 ≤2pp
 * (28 号 §5 口径)。
 */
import { describe, expect, it } from 'vitest'
import { parseTasksPatch } from './fixtures/patch.ts'
import { SettingsSchema, type RoleModel } from '../src/policy/settings.ts'
import { ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID } from '../src/session/presets.ts'

/** 包根 cordis.patch.yml(与 preset.spec 同源解析,!!js 前处理见 fixtures/patch.ts)。 */
const rows = parseTasksPatch()
const presets = (rows.find(row => row.insert !== undefined)?.insert as Array<Record<string, unknown>>)
  .filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
const compactionBasicConfig = (id: string): Record<string, unknown> | undefined => {
  const preset = presets.find(row => (row.config as Record<string, unknown>).id === id)
  const plugins = (preset!.config as Record<string, unknown>).plugins as Array<Record<string, unknown>>
  const group = plugins.find(plugin => plugin.id === 'compaction') as { config: Array<Record<string, unknown>> }
  return group.config.find(row => row.id === 'compaction-basic')?.config as Record<string, unknown> | undefined
}

describe('双角色模型配置(34 §4-D role-models 行;SA role-models.ts 语义落 settings)', () => {
  it('settings 双角色模型键:eval.model(orchestrator 评估)与 executor.model(worker 执行)同为 RoleModel 三键', () => {
    const settings = SettingsSchema.parse({})
    // 缺省 null = 不覆写、随宿主会话默认模型(SA initializeRoleModel 的缺席不播种语义)。
    expect(settings.eval.model).toBeNull()
    expect(settings.executor.model).toBeNull()
  })

  it('RoleModel 形状:provider/model 必填、reasoningEffort 可选、未知键拒收(24 §8.3-1 zod 纪律)', () => {
    const model: RoleModel = { provider: 'pi-ai', model: 'deepseek-flash' }
    expect(SettingsSchema.parse({ eval: { model } }).eval.model).toEqual(model)
    expect(SettingsSchema.parse({ executor: { model: { ...model, reasoningEffort: 'high' } } }).executor.model)
      .toEqual({ provider: 'pi-ai', model: 'deepseek-flash', reasoningEffort: 'high' })
    expect(() => SettingsSchema.parse({ eval: { model: { provider: '', model: 'x' } } }).eval.model).toThrow()
    expect(() => SettingsSchema.parse({ eval: { model: { ...model, extra: 1 } } }).eval.model).toThrow()
  })
})

describe('★C5 主 Session 摘要档位绑定(22a 结论档;24a C5;G2-A17)+ 53 号 D2 特化参数', () => {
  it('orchestrator 压缩组分档键落位为空串对 = 会话模型(22a §4 拍板 Q1 结论 A)+ D2 特化参数', () => {
    const config = compactionBasicConfig(ORCHESTRATOR_PRESET_ID)
    expect(config, 'orchestrator compaction-basic 带 config').toBeDefined()
    // 成对落位:两键同在、同为空串(空 = 会话模型;非空即换档,须全量重跑压缩 golden)。
    // D2 特化键同落一行:thresholdRatio/attachments(键集钉死,漂移即红)。
    expect(Object.keys(config!).sort())
      .toEqual(['attachments', 'summarizationModel', 'summarizationProvider', 'thresholdRatio'])
    expect(config!.summarizationProvider).toBe('')
    expect(config!.summarizationModel).toBe('')
    // 53 号 D2 初值:thresholdRatio 0.8→0.7(与 L2 stale 同档,主会话宁早压)、
    // attachments false→true(C11 附件重读);retainRatio/重试不动(默认参,不落键)。
    expect(config!.thresholdRatio).toBe(0.7)
    expect(config!.attachments).toBe(true)
  })

  it('worker 组不落分档键(28 §9 配置面表:分档键落位在 orchestrator 组;28 §3 照搬 config: {})', () => {
    expect(compactionBasicConfig(WORKER_PRESET_ID)).toEqual({})
  })
})
