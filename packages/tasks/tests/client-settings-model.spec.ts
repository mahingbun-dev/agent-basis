/**
 * 任务设置表单纯逻辑单测(2026-11-19 任务设置分区):
 * - formBlocks/dirtyBlocks:块域划分与脏检查(来源实例逐键展开);
 * - withBlock:逐块增量合并(含来源实例新增/删除;其余块保持服务端现值);
 * - cloneSettings:表单编辑不污染加载快照;
 * - parseSourceConfig/optionalNumber:输入解析边界;
 * - validateSettings:与服务端 schema 同界的客户端校验(规则/来源/评估/执行器/预算/门禁)。
 */
import { describe, expect, it } from 'vitest'
import {
  cloneSettings, dirtyBlocks, formBlocks, optionalNumber, parseSourceConfig, validateSettings, withBlock,
  type TasksSettings,
} from '../src/client/settings-model.ts'

function base(): TasksSettings {
  return {
    paused: false,
    sources: { webchat: { enabled: true, config: { bots: ['ou_x'] } } },
    policy: {
      rules: [{ id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }],
      sources: { feishu: { allowed: [{ id: 'ou_a', name: 'Alice' }], admission: { 'chat:1': { unlistedAddressed: 'explicit' } } } },
    },
    eval: { mode: 'auto', timeoutSeconds: 120, model: { provider: 'deepseek', model: 'chat' } },
    executor: { model: null, maxWorkers: 3, directory: '', prepare: '', blockedCommands: [] },
    budget: {
      caps: { simple: { maxTurns: 3 }, compare: {}, complex: {} },
      pricing: { inputPerMTokens: 0.1, outputPerMTokens: 0.2 },
      creditsPerMTokens: 1,
    },
    gates: { highRiskRules: ['copy'] },
  }
}

describe('formBlocks', () => {
  it('固定块按保存序 + 来源实例块按名排序', () => {
    const settings = base()
    settings.sources = { zeta: { enabled: true, config: {} }, alpha: { enabled: false, config: {} } }
    expect(formBlocks(settings)).toEqual(['pause', 'policy', 'eval', 'executor', 'budget', 'gates', 'source:alpha', 'source:zeta'])
  })
})

describe('dirtyBlocks', () => {
  it('无改动为空表', () => {
    expect(dirtyBlocks(base(), cloneSettings(base()))).toEqual([])
  })

  it('pause 单独成块', () => {
    const after = base()
    after.paused = true
    expect(dirtyBlocks(base(), after)).toEqual(['pause'])
  })

  it('policy/eval/executor/budget/gates 各自命中且按保存序排列', () => {
    const after = base()
    after.policy.rules[0]!.name = 'Copy edited'
    after.eval.timeoutSeconds = 60
    after.executor.maxWorkers = 5
    after.budget.caps.compare.maxTokens = 1000
    after.gates.highRiskRules = []
    expect(dirtyBlocks(base(), after)).toEqual(['policy', 'eval', 'executor', 'budget', 'gates'])
  })

  it('来源实例逐键判定(改动/新增/删除都计入)', () => {
    const after = base()
    after.sources.webchat!.enabled = false
    after.sources.newbot = { enabled: true, config: {} }
    expect(dirtyBlocks(base(), after)).toEqual(['source:newbot', 'source:webchat'])
    const removed = base()
    delete removed.sources.webchat
    expect(dirtyBlocks(base(), removed)).toEqual(['source:webchat'])
  })
})

describe('withBlock', () => {
  it('只替换目标块,其余保持服务端当前值', () => {
    const current = base()
    const form = base()
    form.paused = true
    form.eval.timeoutSeconds = 60
    form.policy.rules[0]!.name = 'local draft'
    const merged = withBlock(current, form, 'eval')
    expect(merged.eval.timeoutSeconds).toBe(60)
    expect(merged.paused).toBe(false)
    expect(merged.policy).toEqual(current.policy)
  })

  it('来源实例块:upsert 与删除', () => {
    const current = base()
    const form = base()
    form.sources.webchat!.config = { bots: ['ou_y'] }
    form.sources.newbot = { enabled: true, config: { token: 't' } }
    expect(withBlock(current, form, 'source:webchat').sources.webchat!.config).toEqual({ bots: ['ou_y'] })
    expect(withBlock(current, form, 'source:newbot').sources.newbot!.config).toEqual({ token: 't' })
    const deleted = base()
    delete deleted.sources.webchat
    expect('webchat' in withBlock(current, deleted, 'source:webchat').sources).toBe(false)
  })

  it('未知块原样返回(白名单外的保守行为)', () => {
    const current = base()
    expect(withBlock(current, base(), 'bogus')).toEqual(current)
  })
})

describe('cloneSettings', () => {
  it('深拷贝:改表单不影响快照', () => {
    const snapshot = base()
    const form = cloneSettings(snapshot)
    form.policy.rules[0]!.name = 'changed'
    expect(snapshot.policy.rules[0]!.name).toBe('Copy')
  })
})

describe('parseSourceConfig', () => {
  it('JSON 对象接受', () => {
    expect(parseSourceConfig('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseSourceConfig('{}')).toEqual({ ok: true, value: {} })
  })

  it('JSON 语法错误 / 非对象一律拒绝', () => {
    expect(parseSourceConfig('{').ok).toBe(false)
    expect(parseSourceConfig('[]').ok).toBe(false)
    expect(parseSourceConfig('null').ok).toBe(false)
    expect(parseSourceConfig('42').ok).toBe(false)
    expect(parseSourceConfig('"x"').ok).toBe(false)
  })
})

describe('optionalNumber', () => {
  it('空串 = 未设限;数字解析;非数字 NaN', () => {
    expect(optionalNumber('')).toBeUndefined()
    expect(optionalNumber('  ')).toBeUndefined()
    expect(optionalNumber('3')).toBe(3)
    expect(optionalNumber('0.5')).toBe(0.5)
    expect(optionalNumber('abc')).toBeNaN()
  })
})

describe('validateSettings', () => {
  it('基线合法', () => {
    expect(validateSettings(base())).toEqual([])
  })

  it('规则:id 非法/重复/名空/指示空', () => {
    const settings = base()
    settings.policy.rules = [
      { id: 'bad id', name: '', enabled: true, instruction: '' },
      { id: 'same', name: 'Same', enabled: true, instruction: 'x' },
      { id: 'same', name: 'Same2', enabled: false, instruction: 'y' },
    ]
    const messages = validateSettings(settings).map(issue => issue.message)
    expect(messages.some(text => text.includes('重复'))).toBe(true)
    expect(messages.some(text => text.includes('名称'))).toBe(true)
    expect(messages.some(text => text.includes('指示'))).toBe(true)
  })

  it('来源名/名单/准入行键', () => {
    const settings = base()
    settings.policy.sources = {
      'Bad Name': { allowed: [{ id: '' }], admission: { '': {} } },
    }
    const messages = validateSettings(settings).map(issue => issue.message)
    expect(messages.some(text => text.includes('来源「Bad Name」'))).toBe(true)
    expect(messages.some(text => text.includes('身份 id'))).toBe(true)
    expect(messages.some(text => text.includes('scope 键'))).toBe(true)
  })

  it('评估超时越界与角色模型空字段', () => {
    const settings = base()
    settings.eval.timeoutSeconds = 10
    settings.eval.model = { provider: ' ', model: '' }
    const messages = validateSettings(settings).map(issue => issue.message)
    expect(messages.some(text => text.includes('评估超时'))).toBe(true)
    expect(messages.some(text => text.includes('供应商'))).toBe(true)
    expect(messages.some(text => text.includes('模型不能为空'))).toBe(true)
  })

  it('执行器:并发越界/相对目录/prepare 过长/被禁 worker 必需命令', () => {
    const settings = base()
    settings.executor.maxWorkers = 0
    settings.executor.directory = 'srv/work'
    settings.executor.prepare = 'x'.repeat(4001)
    settings.executor.blockedCommands = ['git', 'a b']
    const messages = validateSettings(settings).map(issue => issue.message)
    expect(messages.some(text => text.includes('并发上限'))).toBe(true)
    expect(messages.some(text => text.includes('绝对路径'))).toBe(true)
    expect(messages.some(text => text.includes('准备命令'))).toBe(true)
    expect(messages.some(text => text.includes('git'))).toBe(true)
    expect(messages.some(text => text.includes('a b'))).toBe(true)
  })

  it('预算:缺省不设限合法;脏值/负值拒绝', () => {
    const settings = base()
    settings.budget.caps.simple = {}
    expect(validateSettings(settings)).toEqual([])
    settings.budget.caps.complex = { maxTurns: 0, maxTokens: 1.5, maxCost: -1 }
    settings.budget.pricing = { inputPerMTokens: -0.1, outputPerMTokens: 0 }
    settings.budget.creditsPerMTokens = -1
    const messages = validateSettings(settings).map(issue => issue.message)
    expect(messages.filter(text => text.includes('complex'))).toHaveLength(3)
    expect(messages.some(text => text.includes('计价单价'))).toBe(true)
    expect(messages.some(text => text.includes('积分换算率'))).toBe(true)
  })

  it('门禁规则 id 与实例名', () => {
    const settings = base()
    settings.gates.highRiskRules = ['bad id']
    settings.sources = { 'Bad Name': { enabled: true, config: {} } }
    const messages = validateSettings(settings).map(issue => issue.message)
    expect(messages.some(text => text.includes('门禁规则 id'))).toBe(true)
    expect(messages.some(text => text.includes('实例名'))).toBe(true)
  })
})
