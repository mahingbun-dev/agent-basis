/**
 * prompts 装配与版本化测试(35 号 A23 验收门禁;34 号 §4-D「prompts.spec.ts /
 * prompt-config.spec.ts 合并承接:prompt 装配分段、版本绑定每次请求、团队覆盖不漂移」)。
 *
 * 承 SA tests/prompts.spec.ts 与 prompt-config.spec.ts 的判据面,按本仓改造重写:
 * - 装配分段:双角色固定段/团队段/生成段的顺序与专属面(admission/Policy 仅 orchestrator,
 *   work 仅 worker;handoff 为最后一段固定段);
 * - 版本绑定每次请求(24 §8.1-4):Policy 段每次组合按当前 settings 现算;`bind` 把
 *   每次模型请求依据的修订记入 session 绑定史,重启存活;session 只被授权读其活动修订
 *   与曾运行过的修订;
 * - 团队覆盖不漂移(34 §4-D):overrides 按 base 留档、升级只列变更不改写团队文本、
 *   等于内置文本的覆盖自动脱落、本版本已无的件(保存版持有的)静默脱落。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Store } from '../src/store/store.ts'
import { KV } from '../src/store/kv.ts'
import {
  admissionPolicy, builtInBase, builtInParts, composePrompt, defaultPrompts, environmentSection, guides, handoffPolicy,
  orchestratorPrompt, PART_KEYS, policySection, promptFile, promptParts, Prompts, PromptConflict,
  sharedPrompt, workerPrompt, type PromptConfig,
} from '../src/session/prompts.ts'
import { SettingsSchema } from '../src/policy/settings.ts'
import { policyVersion } from '../src/policy/version.ts'
import { UserError } from '../src/core/errors.ts'

/** 样例执行环境行(A16 装配落位前,装配面收渲染好的行)。 */
const ENVIRONMENT_LINE = '- DSH_TASKS_DEMO = "acme/widgets": 演示变量。'
const withStore = (body: (store: Store) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-prompts-'))
  const store = new Store('alice', { tenantRoot: dir })
  try { body(store) } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
}

describe('prompt 装配分段(34 §4-D)', () => {
  it('按序装配双角色:固定段包夹团队段,admission/Policy 属 orchestrator、work 属 worker', () => {
    const config: PromptConfig = { ...defaultPrompts(), communication: '少说。', scope: '', delivery: '附截图。' }
    for (const role of ['orchestrator', 'worker'] as const) {
      const names = promptParts(config, role, 'env').map(part => part.name)
      expect(names).toEqual(['runtime/shared', `runtime/${role}`, 'communication', 'delivery', 'runtime/subscriptions',
        'runtime/replies', role === 'orchestrator' ? 'runtime/dispatch' : 'runtime/work',
        ...role === 'orchestrator' ? ['runtime/admission'] : [], 'runtime/handoff', 'runtime/environment'])
      const prompt = composePrompt(config, role)
      // 全部固定段逐件在文中;handoff(按角色拼接)是最后一段固定段。
      for (const fixed of [sharedPrompt, role === 'orchestrator' ? orchestratorPrompt : workerPrompt,
        guides.subscriptions, guides.replies, handoffPolicy(role)]) expect(prompt).toContain(fixed)
      expect(prompt.endsWith(handoffPolicy(role))).toBe(true)
    }
    expect(composePrompt(config, 'orchestrator')).toContain(admissionPolicy)
    expect(composePrompt(config, 'worker')).not.toContain(admissionPolicy)
    expect(composePrompt(config, 'worker')).toContain(guides.work)
    expect(composePrompt(config, 'orchestrator')).not.toContain(guides.work)
    // 空团队段不出现;非空团队段按其中文标题进入 prompt。
    expect(promptParts(config, 'worker').map(part => part.name)).not.toContain('scope')
    expect(composePrompt(config, 'worker')).toContain('## 沟通约定\n少说。')
    expect(composePrompt(config, 'worker')).not.toContain('## 工单范围')
    expect(composePrompt(config, 'worker')).toContain('## 交付要求\n附截图。')
  })

  it('worker prompt 以执行环境收尾,orchestrator 以其 Policy 段收尾——其后无内容,Policy 变不扰其余', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const settings = store.settings()
      const worker = prompts.compose(defaultPrompts(), 'worker', ENVIRONMENT_LINE)
      expect(worker.endsWith(ENVIRONMENT_LINE)).toBe(true)
      const orchestrator = prompts.compose(defaultPrompts(), 'orchestrator', ENVIRONMENT_LINE)
      expect(orchestrator.endsWith(`${ENVIRONMENT_LINE}\n\n${policySection(settings).text}`)).toBe(true)
      expect(promptParts(defaultPrompts(), 'orchestrator', ENVIRONMENT_LINE, policySection(settings)).at(-1)?.name)
        .toBe('runtime/policy')
      expect(promptParts(defaultPrompts(), 'worker', ENVIRONMENT_LINE).at(-1)?.name).toBe('runtime/environment')
    })
  })

  it('promptFile 读打包资产:段内行并段、空行分段;缺失资产按路径点名抛错', () => {
    const path = fileURLToPath(new URL('../prompts/shared.md', import.meta.url))
    const normalized = readFileSync(path, 'utf8').replaceAll('\r\n', '\n').trim()
      .split(/\n(?:[ \t]*\n)+/).map(paragraph => paragraph.split('\n').map(line => line.trim()).join(' ')).join('\n')
    expect(promptFile('shared')).toBe(normalized)
    expect(promptFile('shared')).not.toContain('\r')
    expect(() => promptFile('no-such-asset')).toThrow(`Missing packaged file: ${join(path, '..', 'no-such-asset.md')}`)
  })

  it('Policy 段列出且仅列出启用的规则;无规则时进入 none 模板', () => {
    const rules = [{ id: 'copy', name: '文案修订', enabled: true, instruction: '改文案。' },
      { id: 'visual', name: '视觉', enabled: false, instruction: '改样式。' }]
    const settings = SettingsSchema.parse({ policy: { rules } })
    const policy = policySection(settings)
    expect(policy.key).toBe('runtime/policy')
    expect(policy.text).toContain(`Policy 版本 ${policyVersion(settings)};受理档位 ${settings.eval.mode}。`)
    expect(policy.text).toContain('- 文案修订 (copy): 改文案。')
    expect(policy.text).not.toContain('视觉')
    const none = policySection(SettingsSchema.parse({}))
    expect(none.key).toBe('runtime/policy/none')
    expect(none.text).toContain('没有启用任何规则:主动候选只能 ignore。')
  })

  it('执行环境段:setup 未完成时说明在等待', () => {
    expect(environmentSection(defaultPrompts(), undefined)).toContain('正在等待 setup')
    expect(environmentSection(defaultPrompts(), ENVIRONMENT_LINE).endsWith(ENVIRONMENT_LINE)).toBe(true)
  })
})

describe('版本绑定每次请求(24 §8.1-4;34 §4-D)', () => {
  it('Policy 段每次组合按当前 settings 现算——settings 热改后,下一次组合即反映,无需新配置修订', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const before = prompts.compose(defaultPrompts(), 'orchestrator')
      expect(before).toContain('没有启用任何规则')
      store.saveSettings(SettingsSchema.parse({ policy: { rules: [{ id: 'copy', name: '文案修订', enabled: true, instruction: '改文案。' }] } }))
      const after = prompts.compose(defaultPrompts(), 'orchestrator')
      expect(after).toContain('- 文案修订 (copy): 改文案。')
      expect(after).toContain(`Policy 版本 ${policyVersion(store.settings())}`)
      // 配置修订未动:变化来自每次请求的现算,不是新的 prompt 配置。
      expect(prompts.current().revision).toBe(0)
    })
  })

  it('bind 把每次模型请求依据的修订记入 session 绑定史;同修订不重复,重启存活', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-prompts-bind-'))
    let store = new Store('alice', { tenantRoot: dir })
    try {
      let prompts = new Prompts(store)
      expect(prompts.bind('orchestrator-main')).toBe(0)
      const saved = prompts.save({ ...defaultPrompts(), communication: '我们的口径。' }, 0, 'panel')
      expect(prompts.bind('orchestrator-main')).toBe(saved.revision)
      const again = prompts.save({ ...defaultPrompts(), communication: '我们的口径,修订。' }, saved.revision, 'panel')
      expect(prompts.bind('worker-T1')).toBe(again.revision)
      // 同修订重复绑定不重复记;绑定史按 session 各自记录。
      prompts.bind('orchestrator-main')
      expect(store.get(KV.prompts.binding('orchestrator-main'))).toEqual([0, saved.revision, again.revision])
      expect(store.get(KV.prompts.binding('worker-T1'))).toEqual([again.revision])
      store.close(); store = new Store('alice', { tenantRoot: dir }); prompts = new Prompts(store)
      expect(prompts.boundRevision('orchestrator-main')).toBe(again.revision)
      expect(prompts.boundVersion('orchestrator-main').config.communication).toBe('我们的口径,修订。')
      // 未绑定的 session 读当前版本(SA promptVersion 语义)。
      expect(prompts.boundVersion('worker-T2').revision).toBe(prompts.current().revision)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })

  it('session 只被授权读其活动修订与曾运行过的修订', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      prompts.bind('orchestrator-main')
      const first = prompts.save({ ...defaultPrompts(), communication: '一版。' }, 0, 'panel')
      prompts.bind('orchestrator-main')
      const second = prompts.save({ ...defaultPrompts(), communication: '二版。' }, first.revision, 'panel')
      expect(prompts.ranUnder('orchestrator-main', second.revision)).toBe(true)
      expect(prompts.ranUnder('orchestrator-main', first.revision)).toBe(true)
      expect(prompts.ranUnder('orchestrator-main', 0)).toBe(true)
      prompts.bind('worker-T9')
      expect(prompts.ranUnder('worker-T9', first.revision)).toBe(false)
      expect(() => prompts.version(99)).toThrow(UserError)
    })
  })
})

describe('配置版本史(34 §4-D prompt-config 半边)', () => {
  it('团队段与团队 skill 存为版本:重启存活、全史可回滚、对着过期基准保存抛冲突', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-prompts-config-'))
    let store = new Store('alice', { tenantRoot: dir })
    try {
      let prompts = new Prompts(store)
      expect(prompts.current().config).toEqual(defaultPrompts())
      const config: PromptConfig = { ...defaultPrompts(), scope: '做完被要求的。', delivery: '',
        skills: { release: '周五打 tag。' } }
      prompts.save(config, 0, 'panel')
      expect(composePrompt(prompts.current().config, 'worker')).toContain('## 工单范围\n做完被要求的。')
      expect(promptParts(config, 'worker').map(part => part.name)).not.toContain('delivery')
      expect(store.get(KV.settings.revision)).toBeUndefined()
      store.close(); store = new Store('alice', { tenantRoot: dir }); prompts = new Prompts(store)
      expect(prompts.current()).toMatchObject({ revision: 1, config })
      prompts.save(prompts.version(0).config, 1, 'tool')
      expect(prompts.current()).toMatchObject({ revision: 2, previousRevision: 1, config: defaultPrompts() })
      expect(prompts.history(0, 1)).toMatchObject({ revisions: [{ revision: 2 }], next_offset: 1 })
      expect(prompts.history(2, 1).next_offset).toBeNull()
      expect(prompts.history(1, 1).revisions[0]).toMatchObject({ revision: 1, changed: ['scope', 'skill/release'] })
      expect(() => prompts.save(config, 1, 'panel')).toThrow(PromptConflict)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })

  it('拒收未知键、坏 skill 名与超限配置,且不落任何修订', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      expect(() => prompts.save({ ...defaultPrompts(), shared: 'x' }, 0, 'panel')).toThrow()
      expect(() => prompts.save({ communication: '', scope: '' }, 0, 'panel')).toThrow()
      expect(() => prompts.save({ ...defaultPrompts(), skills: { 'Bad Name': 'x' } }, 0, 'panel')).toThrow()
      expect(() => new Prompts(store, () => 10).save(defaultPrompts(), 0, 'panel')).toThrow('exceeds')
      expect(prompts.current().revision).toBe(0)
    })
  })

  it('团队 skill 只经 skills 清单出现;内置 Source skill 属 A21 未入', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const config: PromptConfig = { ...defaultPrompts(), skills: { release: '周五打 tag。' } }
      expect(prompts.skills(config)).toEqual([['release', '周五打 tag。']])
    })
  })
})

describe('团队覆盖不漂移(34 §4-D)', () => {
  const config = (overrides: PromptConfig['overrides']): PromptConfig => ({ ...defaultPrompts(), overrides })

  it('覆盖件在原位替换内置文本,只影响读它的角色;handoff 按角色各盖各的', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const edited = prompts.validate(config({ 'runtime/shared': { text: '共享段,团队的写法。' }, 'runtime/dispatch': { text: '## dispatch\n好好路由。' },
        'runtime/handoff/worker': { text: 'worker 的交接。' } }))
      const main = prompts.compose(edited, 'orchestrator'), worker = prompts.compose(edited, 'worker')
      for (const prompt of [main, worker]) expect(prompt.startsWith('共享段,团队的写法。\n\n')).toBe(true)
      expect(main).toContain('## dispatch\n好好路由。')
      expect(main).not.toContain(guides.dispatch)
      expect(worker).toContain('worker 的交接。')
      expect(main).toContain(handoffPolicy('orchestrator'))
      expect(worker).toContain(guides.work)
      expect(promptParts(edited, 'worker').find(part => part.name === 'runtime/handoff'))
        .toMatchObject({ key: 'runtime/handoff/worker', text: 'worker 的交接。' })
    })
  })

  it('生成段模板的覆盖保留占位符,数据仍由系统填充', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const edited = prompts.validate(config({ 'runtime/environment': { text: '你在哪里工作:\n{variables}\n别向任何人要更多。' },
        'runtime/policy': { text: '## Policy\n{version} 的 {mode} 档规则:\n{rules}' },
        'runtime/policy/none': { text: '## Policy\n{version},{mode}:无可接受。' } }))
      expect(prompts.compose(edited, 'worker', ENVIRONMENT_LINE).endsWith(`你在哪里工作:\n${ENVIRONMENT_LINE}\n别向任何人要更多。`)).toBe(true)
      const settings = SettingsSchema.parse({ policy: { rules: [{ id: 'x', name: 'X', enabled: true, instruction: '改文案。' }] } })
      expect(policySection(settings, edited)).toEqual({ key: 'runtime/policy',
        text: `## Policy\n${policyVersion(settings)} 的 ${settings.eval.mode} 档规则:\n- X (x): 改文案。` })
      const none = SettingsSchema.parse({})
      expect(policySection(none, edited)).toEqual({ key: 'runtime/policy/none', text: `## Policy\n${policyVersion(none)},${none.eval.mode}:无可接受。` })
      // 规则文本里写了占位符样文本不被二次填充。
      const named = SettingsSchema.parse({ policy: { rules: [{ id: 'x', name: 'X', enabled: true, instruction: '保持 {mode} 与 $& 原样。' }] } })
      expect(policySection(named, edited).text.endsWith('- X (x): 保持 {mode} 与 $& 原样。')).toBe(true)
    })
  })

  it('拒收未知件、丢占位符的模板与空文本;等于内置文本的覆盖自动脱落;整份配置受限', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      expect(() => prompts.validate(config({ 'runtime/nothing': { text: 'x' } }))).toThrow(new UserError('unknownPromptPart', { part: 'runtime/nothing' }))
      expect(() => prompts.validate(config({ 'runtime/policy': { text: '## Policy\n{version} {mode}' } })))
        .toThrow(new UserError('promptPlaceholders', { part: 'runtime/policy', placeholders: '{rules}' }))
      expect(() => prompts.validate(config({ 'runtime/environment': { text: '你在哪里工作。' } })))
        .toThrow(new UserError('promptPlaceholders', { part: 'runtime/environment', placeholders: '{variables}' }))
      expect(() => prompts.validate(config({ 'runtime/shared': { text: ' \n ' } }))).toThrow(new UserError('promptPartEmpty', { part: 'runtime/shared' }))
      // 回到内置文本:该件重新随内置文本走,后续升级随之更新。
      expect(prompts.validate(config({ 'runtime/shared': { text: sharedPrompt } }))).not.toHaveProperty('overrides')
      expect(() => new Prompts(store, () => 5000).validate(config({ 'runtime/shared': { text: 'x'.repeat(5000) } }))).toThrow(UserError)
    })
  })

  it('覆盖件记录编辑自的内置文本键;内置文本变化只经 defaultChanged 列出,升级不改写团队文本', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      // 编辑自今天内置文本的覆盖:无可展示。
      const saved = prompts.save(config({ 'runtime/dispatch': { text: '## dispatch\n好好路由。' } }), 0, 'panel')
      expect(saved.config.overrides!['runtime/dispatch']!.base).toBe(builtInBase(`## dispatch\n${guides.dispatch}`))
      expect(prompts.defaultChanged(saved.config)).toEqual([])
      // 一份编辑自更早版本内置文本的覆盖——该内置文本在其被保存时留过档。
      const earlier = '## replies\n一份更早的内置文本。'
      store.set(KV.prompts.builtIn(builtInBase(earlier)), earlier)
      const upgraded = prompts.save(config({ ...saved.config.overrides, 'runtime/replies': { text: '我们的回复。', base: builtInBase(earlier) },
        'runtime/work': { text: '我们的工作。', base: 'unknown' } }), saved.revision, 'panel')
      expect(prompts.defaultChanged(upgraded.config)).toEqual([{ part: 'runtime/replies', base: builtInBase(earlier), previous: earlier },
        { part: 'runtime/work', base: 'unknown' }])
      // 团队文本原样保留:升级永不替换它。
      expect(prompts.compose(prompts.current().config, 'worker')).toContain('我们的回复。')
    })
  })

  it('保存省略 base 时沿用保存版的 base;重定基的覆盖在历史里记为变更', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const first = prompts.save(config({ 'runtime/shared': { text: '我们的。', base: 'earlier' } }), 0, 'panel')
      const second = prompts.save(config({ 'runtime/shared': { text: '我们的,改过。' } }), first.revision, 'tool')
      expect(second.config.overrides!['runtime/shared']).toEqual({ text: '我们的,改过。', base: 'earlier' })
      const rebased = prompts.save(config({ 'runtime/shared': { text: '我们的,改过。', base: builtInBase(sharedPrompt) } }), second.revision, 'panel')
      expect(prompts.history().revisions.find(version => version.revision === rebased.revision)!.changed).toEqual(['runtime/shared'])
    })
  })

  it('本版本已无的件:保存版持有的覆盖静默脱落并列为 removed;客户端编造的拒收', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const stale: PromptConfig = { ...defaultPrompts(), overrides: { 'runtime/retired': { text: '旧的。', base: 'b' } } }
      expect(() => prompts.validate(stale)).toThrow(new UserError('unknownPromptPart', { part: 'runtime/retired' }))
      store.set(KV.prompts.version(1), { revision: 1, previousRevision: 0, savedAt: '', source: 'panel', config: stale })
      store.set(KV.prompts.revision, 1)
      expect(prompts.defaultChanged(stale)).toEqual([{ part: 'runtime/retired', base: 'b', removed: true }])
      expect(prompts.validate(stale)).toEqual(defaultPrompts())
    })
  })

  it('读过没有 overrides 时代的旧配置不变形;原型上的键名不指任何件', () => {
    withStore((store) => {
      const prompts = new Prompts(store)
      const saved = prompts.save({ ...defaultPrompts(), communication: '我们的。' }, 0, 'panel')
      expect(saved.config).toEqual({ ...defaultPrompts(), communication: '我们的。' })
      expect(prompts.compose(saved.config, 'orchestrator'))
        .toBe(prompts.compose({ ...defaultPrompts(), communication: '我们的。', overrides: {} }, 'orchestrator'))
      for (const part of ['constructor', 'toString']) {
        const named = JSON.parse(`{"${part}": { "text": "x" }}`) as PromptConfig['overrides']
        expect(() => prompts.validate(config(named))).toThrow(new UserError('unknownPromptPart', { part }))
      }
      const proto = JSON.parse('{"__proto__": { "text": "x" }}') as PromptConfig['overrides']
      expect(prompts.validate(config(proto))).toEqual(defaultPrompts())
      const edited = prompts.validate(config({ 'runtime/environment': { text: '{constructor} {toString}\n{variables}' } }))
      expect(prompts.compose(edited, 'worker', ENVIRONMENT_LINE).endsWith(`{constructor} {toString}\n${ENVIRONMENT_LINE}`)).toBe(true)
    })
  })

  it('PART_KEYS 与内置件表一致:13 件 runtime 件,skill 件属 A21 未入', () => {
    expect(Object.keys(builtInParts()).sort()).toEqual([...PART_KEYS].slice().sort())
    expect(builtInParts()['runtime/policy'].placeholders).toEqual(['{version}', '{mode}', '{rules}'])
    expect(builtInParts()['runtime/environment'].roles).toEqual(['orchestrator', 'worker'])
  })
})
