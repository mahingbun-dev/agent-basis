/**
 * R0-R3 → DSH permission-presets 配置产物生成器测试(分档映射)。
 * 断言依据:dsh-repo packages/interaction/permission-presets/README.md:34-52
 * (presets 表 + defaultPreset + 保留名 custom/auto)与 docs/subsystems/permission-presets.md。
 */
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  GRADE_PRESET_BUNDLES, HitlPolicy, InteractConfigError, RESERVED_PRESET_NAMES,
  generatePresetArtifact, renderPresetYaml,
} from '../src/index.ts'

const HITL_R3_DEFAULT = `
pack: event-planning
default_grade: R3
rules:
  - { id: pay, grade: R3, tools: ['pay_*'] }
  - { id: draft, grade: R1, tools: ['write_file'] }
`

describe('分档映射:R0-R3 → sandbox+approval 旋钮', () => {
  it('R0 只读 → read-only + never;R1 可逆写 → workspace-write + never', () => {
    expect(GRADE_PRESET_BUNDLES.R0).toEqual({ sandbox: 'read-only', approval: 'never' })
    expect(GRADE_PRESET_BUNDLES.R1).toEqual({ sandbox: 'workspace-write', approval: 'never' })
  })

  it('R2 需确认 / R3 高危 → workspace-write + ask', () => {
    expect(GRADE_PRESET_BUNDLES.R2).toEqual({ sandbox: 'workspace-write', approval: 'ask' })
    expect(GRADE_PRESET_BUNDLES.R3).toEqual({ sandbox: 'workspace-write', approval: 'ask' })
  })

  it('旋钮取值均在 DSH 官方词汇内(SandboxMode 三态 / ApprovalPolicy 两态)', () => {
    const sandboxModes = ['read-only', 'workspace-write', 'danger-full-access']
    const approvalPolicies = ['ask', 'never']
    for (const bundle of Object.values(GRADE_PRESET_BUNDLES)) {
      expect(sandboxModes).toContain(bundle.sandbox)
      expect(approvalPolicies).toContain(bundle.approval)
    }
  })
})

describe('generatePresetArtifact 产物', () => {
  const hitl = HitlPolicy.parse(HITL_R3_DEFAULT)
  const artifact = generatePresetArtifact(hitl.document)

  it('每档各一个预设,共 4 项,档→预设名映射完整', () => {
    expect(Object.keys(artifact.config.presets)).toHaveLength(4)
    expect(artifact.gradeToPreset.R0).toBe('basis-r0-readonly')
    expect(artifact.gradeToPreset.R1).toBe('basis-r1-reversible')
    expect(artifact.gradeToPreset.R2).toBe('basis-r2-confirm')
    expect(artifact.gradeToPreset.R3).toBe('basis-r3-highrisk')
  })

  it('每个预设条目都落在其档的旋钮 bundle 上(名实一致)', () => {
    for (const [grade, presetName] of Object.entries(artifact.gradeToPreset)) {
      const preset = artifact.config.presets[presetName]
      expect(preset, `${grade} 的预设 ${presetName} 应存在`).toBeDefined()
      expect(preset!.sandbox).toBe(GRADE_PRESET_BUNDLES[grade as keyof typeof GRADE_PRESET_BUNDLES].sandbox)
      expect(preset!.approval).toBe(GRADE_PRESET_BUNDLES[grade as keyof typeof GRADE_PRESET_BUNDLES].approval)
    }
  })

  it('defaultPreset 取 default_grade 对应档(R3 文档 → r3-highrisk)', () => {
    expect(artifact.config.defaultPreset).toBe('basis-r3-highrisk')
    const r2Artifact = generatePresetArtifact(HitlPolicy.parse('default_grade: R2\nrules: []').document)
    expect(r2Artifact.config.defaultPreset).toBe('basis-r2-confirm')
  })

  it('不产出 DSH 保留名 custom/auto', () => {
    for (const name of Object.keys(artifact.config.presets)) {
      expect(RESERVED_PRESET_NAMES).not.toContain(name)
    }
  })

  it('namePrefix 可换;撞保留名前缀拒绝', () => {
    const custom = generatePresetArtifact(hitl.document, { namePrefix: 'event' })
    expect(custom.gradeToPreset.R2).toBe('event-r2-confirm')
    // 前缀构造出保留名(custom/auto)在生成期拒绝
    expect(() => generatePresetArtifact(hitl.document, { namePrefix: '' })).toThrow(InteractConfigError)
  })

  it('renderPresetYaml 产物是合法 YAML 插件行,round-trip 保形', () => {
    type PresetRow = { name: string; config: { presets: Record<string, { sandbox: string; approval: string }>; defaultPreset: string } }
    const yamlText = renderPresetYaml(artifact)
    const rows = parse(yamlText) as PresetRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('@deepseek-ai/dsh-permission-presets')
    expect(rows[0]?.config.defaultPreset).toBe('basis-r3-highrisk')
    expect(rows[0]?.config.presets['basis-r0-readonly']).toMatchObject({ sandbox: 'read-only', approval: 'never' })
    expect(rows[0]?.config.presets['basis-r2-confirm']).toMatchObject({ sandbox: 'workspace-write', approval: 'ask' })
  })
})
