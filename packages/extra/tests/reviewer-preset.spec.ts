/**
 * reviewer preset 产物单测(任务指定三测之三):**preset 产物 schema 校验** ——
 * 生成的产物必须过校验;各坏形态(混入变更工具/preset 脱钩/档位错)必须
 * 整包拒收;另覆盖 YAML 渲染与工具门挂载 seam。
 */
import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  DEFAULT_REVIEWER_ALLOW, READ_ONLY_TOOL_VOCABULARY, applyReviewerToolGate, buildReviewerPreset,
  renderReviewerPresetYaml, reviewerPersonaPrefix, validateReviewerPresetArtifact,
} from '../src/reviewer-preset.ts'
import { ExtraConfigError } from '../src/errors.ts'

describe('buildReviewerPreset 产物生成', () => {
  it('缺省产物:allow=read/grep/glob,过 schema 校验', () => {
    const artifact = buildReviewerPreset()
    expect([...artifact.toolGate.config.allow]).toEqual([...DEFAULT_REVIEWER_ALLOW])
    expect(artifact.toolGate.config.allow).not.toContain('write')
    const validation = validateReviewerPresetArtifact(artifact)
    expect(validation).toEqual({ ok: true })
  })

  it('preset.plugins 含 persona 行与工具门行;subagent 行 agentPreset 指向 preset.id', () => {
    const artifact = buildReviewerPreset({ presetId: 'event-reviewer' })
    expect(artifact.preset.id).toBe('event-reviewer')
    expect(artifact.preset.plugins.map(row => row.name)).toEqual(['@deepseek-ai/dsh-persona', '@eterna/extra'])
    expect(artifact.subagent.config.agentPreset).toBe('event-reviewer')
    expect(artifact.subagent.config.provider).toBe('spawn')
    expect(artifact.subagent.config.toolName).toBe('reviewer')
  })

  it('persona 模板:缺省四段身份声明;focus 追加重点段;无插值占位符', () => {
    const base = reviewerPersonaPrefix()
    expect(base).toContain('只读审查员')
    expect(base).toContain('read/grep/glob')
    expect(base).not.toContain('{{')
    const focused = reviewerPersonaPrefix('核对报价单总额与明细加总一致')
    expect(focused.startsWith(base)).toBe(true)
    expect(focused).toContain('本次审查重点:核对报价单总额与明细加总一致')
    expect(buildReviewerPreset().persona.config.prefix).toBe(base)
  })

  it.each([
    ['presetId 大写', { presetId: 'Bad-ID' }],
    ['presetId 下划线', { presetId: 'bad_id' }],
    ['allow 混入 write', { allow: ['read', 'write'] }],
    ['allow 混入 web_fetch', { allow: ['read', 'web_fetch'] }],
    ['allow 空', { allow: [] }],
    ['persona prefix 覆写为空白', { personaPrefix: '   ' }],
  ])('构造期 fail-closed:%s 抛 ExtraConfigError', (_label, options) => {
    expect(() => buildReviewerPreset(options as Parameters<typeof buildReviewerPreset>[0])).toThrow(ExtraConfigError)
  })

  it('allow 去重(read 重复只留一份)', () => {
    const artifact = buildReviewerPreset({ allow: ['read', 'read', 'grep'] })
    expect([...artifact.toolGate.config.allow]).toEqual(['read', 'grep'])
  })
})

describe('validateReviewerPresetArtifact schema 校验(坏形态必须整包拒收)', () => {
  const good = buildReviewerPreset()

  /** 深拷贝 + 定点篡改。 */
  function mutate(mutator: (draft: Record<string, unknown>) => void): unknown {
    const draft = JSON.parse(JSON.stringify(good)) as Record<string, unknown>
    mutator(draft)
    return draft
  }

  it.each([
    ['schemaVersion 错', (d: Record<string, unknown>) => { d['schemaVersion'] = 2 }],
    ['persona.prefix 空串', (d: Record<string, unknown>) => {
      ((d['persona'] as Record<string, unknown>)['config'] as Record<string, unknown>)['prefix'] = ''
    }],
    ['persona.includeRuntimeContext 非 false', (d: Record<string, unknown>) => {
      ((d['persona'] as Record<string, unknown>)['config'] as Record<string, unknown>)['includeRuntimeContext'] = true
    }],
    ['toolGate.plugin 冒名', (d: Record<string, unknown>) => {
      (d['toolGate'] as Record<string, unknown>)['plugin'] = '@eterna/evil'
    }],
    ['toolGate.config.module 错', (d: Record<string, unknown>) => {
      ((d['toolGate'] as Record<string, unknown>)['config'] as Record<string, unknown>)['module'] = 'other-gate'
    }],
    ['toolGate.allow 空', (d: Record<string, unknown>) => {
      ((d['toolGate'] as Record<string, unknown>)['config'] as Record<string, unknown>)['allow'] = []
    }],
    ['toolGate.allow 混入 write(词汇表外 + 拒绝 glob 双命中)', (d: Record<string, unknown>) => {
      ((d['toolGate'] as Record<string, unknown>)['config'] as Record<string, unknown>)['allow'] = ['read', 'write']
    }],
    ['toolGate.allow 混入 mcp__fs__write', (d: Record<string, unknown>) => {
      ((d['toolGate'] as Record<string, unknown>)['config'] as Record<string, unknown>)['allow'] = ['read', 'mcp__fs__write']
    }],
    ['toolGate.allow 重复项', (d: Record<string, unknown>) => {
      ((d['toolGate'] as Record<string, unknown>)['config'] as Record<string, unknown>)['allow'] = ['read', 'read']
    }],
    ['subagent.agentPreset 与 preset.id 脱钩', (d: Record<string, unknown>) => {
      ((d['subagent'] as Record<string, unknown>)['config'] as Record<string, unknown>)['agentPreset'] = 'other-preset'
    }],
    ['subagent.provider=fork(不支独立 agentPreset)', (d: Record<string, unknown>) => {
      ((d['subagent'] as Record<string, unknown>)['config'] as Record<string, unknown>)['provider'] = 'fork'
    }],
    ['preset.id 非法字符', (d: Record<string, unknown>) => {
      (d['preset'] as Record<string, unknown>)['id'] = 'Bad ID'
    }],
    ['preset.plugins 行缺 name', (d: Record<string, unknown>) => {
      ((d['preset'] as Record<string, unknown>)['plugins'] as Record<string, unknown>[]).push({ id: 'x' })
    }],
  ])('%s → ok:false 且错误信息可定位', (_label, mutator) => {
    const validation = validateReviewerPresetArtifact(mutate(mutator))
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.errors.length).toBeGreaterThan(0)
  })

  it('非对象输入直接拒收', () => {
    expect(validateReviewerPresetArtifact(null).ok).toBe(false)
    expect(validateReviewerPresetArtifact(42).ok).toBe(false)
    expect(validateReviewerPresetArtifact('reviewer').ok).toBe(false)
  })

  it('词汇表边界:read_image 可加列(只读),write 永不可', () => {
    expect(validateReviewerPresetArtifact(buildReviewerPreset({ allow: ['read', 'read_image', 'grep', 'glob'] })).ok).toBe(true)
    expect(READ_ONLY_TOOL_VOCABULARY).toEqual(['read', 'read_image', 'grep', 'glob'])
  })
})

describe('renderReviewerPresetYaml(产物 → profile 行)', () => {
  it('渲染前强制校验;渲染结果可回读,含 agent-preset 行与 tool-subagent 行', () => {
    const artifact = buildReviewerPreset({ presetId: 'event-reviewer' })
    const yaml = renderReviewerPresetYaml(artifact)
    const rows = parseYaml(yaml) as { id: string; name: string; config: Record<string, unknown> }[]
    expect(rows.map(row => row.name)).toEqual(['@deepseek-ai/dsh-agent-preset', '@deepseek-ai/dsh-tool-subagent'])
    const presetRow = rows[0]!
    expect(presetRow.id).toBe('preset-event-reviewer')
    const presetConfig = presetRow.config as { id: string; plugins: { name: string }[] }
    expect(presetConfig.id).toBe('event-reviewer')
    expect(presetConfig.plugins.map(row => row.name)).toEqual(['@deepseek-ai/dsh-persona', '@eterna/extra'])
    const personaRow = presetConfig.plugins[0]! as unknown as { config: { prefix: string; includeRuntimeContext: boolean } }
    expect(personaRow.config.includeRuntimeContext).toBe(false)
    expect(personaRow.config.prefix).toContain('只读审查员')
    const subagentRow = rows[1]!
    expect((subagentRow.config as { agentPreset: string }).agentPreset).toBe('event-reviewer')
  })

  it('未过校验的产物渲染即抛(fail-closed)', () => {
    const bad = buildReviewerPreset() as unknown as Record<string, unknown>
    ;((bad['subagent'] as Record<string, unknown>)['config'] as Record<string, unknown>)['agentPreset'] = 'detached'
    expect(() => renderReviewerPresetYaml(bad as never)).toThrow(ExtraConfigError)
  })
})

describe('applyReviewerToolGate(工具门挂载 seam,ctx.tools.restrict 结构面)', () => {
  it('宿主收到 allow 名单 restrict,disposer 原样返回(effect 配逆直通)', () => {
    const lifts: string[] = []
    const restrict = vi.fn((filter: { allow?: readonly string[]; deny?: readonly string[] }) => {
      expect(filter.deny).toBeUndefined()
      return () => lifts.push('lifted')
    })
    const dispose = applyReviewerToolGate({ restrict }, ['read', 'grep', 'glob'])
    expect(restrict).toHaveBeenCalledWith({ allow: ['read', 'grep', 'glob'] })
    dispose()
    expect(lifts).toEqual(['lifted'])
  })

  it('空名单/词汇表外名单构造期抛', () => {
    expect(() => applyReviewerToolGate({ restrict: () => () => undefined }, [])).toThrow(ExtraConfigError)
    expect(() => applyReviewerToolGate({ restrict: () => () => undefined }, ['write'])).toThrow(ExtraConfigError)
  })
})
