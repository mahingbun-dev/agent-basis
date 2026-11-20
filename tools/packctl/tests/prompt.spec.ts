/**
 * prompt-scan(T2.5)单测:测试计划 §4 T2.5(b) 的三向断言——
 * 1. 未登记提示词被拦(patch 型 config 键 / 源码 section 使用 / packs persona 三个面);
 * 2. 登记后通过(真实注册表对账 + 注入登记元数据两种形态);
 * 3. 误报防护(注释/测试文件/非 persona 插件同名键/白名单豁免)+ 豁免标注机制单测。
 * 测试形态照抄 tenant.spec.ts:makeRepo 造临时仓库 → promptScan(dir) → 按 finding code 断言。
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runPack } from '../src/cli.ts'
import { PROMPT_SCAN_WHITELIST, promptScan } from '../src/prompt.ts'
import type { PromptRegistryEntry } from '@eterna/prompt-studio/registry'
import type { PromptWhitelistEntry } from '../src/prompt.ts'

/** 真实仓库根(测试目录上三级;模板/注册表真值对账与 registry.test.ts 同口径)。 */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

/** 构造临时仓库文件:rel 为仓库根相对 POSIX 路径;内容即待扫描文本。 */
function writeFile(root: string, rel: string, text: string): void {
  const target = join(root, rel)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text, 'utf8')
}

/** 故意未登记的 rogue 构造(三个面各至少一处,测试方向 1 的被测对象)。 */
function makeRogueRepo(root: string): void {
  // P1-①:preset 层未登记的 persona prefix + plan-mode section(profiles 面)
  writeFile(root, 'profiles/rogue-web/cordis.patch.yml', [
    '- id: preset-rogue',
    '  config:',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    '          prefix: You are a rogue agent.',
    '      - id: planning',
    '        name: cordis:group',
    '        config:',
    '          - id: plan-mode',
    "            name: '@deepseek-ai/dsh-plan-mode'",
    '            config:',
    '              section: |',
    '                Rogue plan mode text.',
    '',
    '# 领域 persona(未登记)',
    '- id: system-prompt',
    '  config:',
    '    personaPrefix: >-',
    '      Rogue domain persona.',
    '',
  ].join('\n'))
  // P1-①' + P2:packs 面未登记的 personaPrefix 与 persona.md
  writeFile(root, 'packs/rogue-pack/cordis.patch.yml', [
    '- id: system-prompt',
    '  config:',
    '    personaPrefix: >-',
    '      Rogue pack persona.',
    '',
  ].join('\n'))
  writeFile(root, 'packs/rogue-pack/persona.md', '# persona\n\nrogue 全文\n')
  // P3:源码 section 使用未登记
  writeFile(root, 'packages/eterna-rogue/src/index.ts',
    'export function apply(ctx) {\n  ctx.systemPrompt.section(section)\n}\n')
}

/** 与 makeRogueRepo 同构造一一对应的登记元数据(测试方向 2 的注入形态)。 */
function rogueRegistry(): readonly PromptRegistryEntry[] {
  const presetPatch = 'profiles/rogue-web/cordis.patch.yml'
  const packPatch = 'packs/rogue-pack/cordis.patch.yml'
  return [
    {
      id: 'test.rogue.preset.persona', layer: 'preset', kind: 'patch-value', source: 'test',
      yaml: { file: presetPatch, rowId: 'preset-rogue', pluginPath: ['persona'], configKey: 'prefix' },
      anchors: [{ file: presetPatch, line: 7, contains: 'prefix:' }],
      note: 'n', description: '测试夹具条目的中文说明占位(登记铁律:description 必填非空)。', risks: ['r'], redLine: 'exempt', maxBytes: 65536,
      effect: { radius: 'immediate-new-session', note: '测试夹具占位:门禁扫描不消费生效半径(T2.2 起必填)' },
    },
    {
      id: 'test.rogue.preset.plan-mode', layer: 'preset', kind: 'patch-value', source: 'test',
      yaml: { file: presetPatch, rowId: 'preset-rogue', pluginPath: ['planning', 'plan-mode'], configKey: 'section' },
      anchors: [{ file: presetPatch, line: 13, contains: 'section:' }],
      note: 'n', description: '测试夹具条目的中文说明占位(登记铁律:description 必填非空)。', risks: ['r'], redLine: 'exempt', maxBytes: 65536,
      effect: { radius: 'immediate-new-session', note: '测试夹具占位:门禁扫描不消费生效半径(T2.2 起必填)' },
    },
    {
      id: 'test.rogue.preset.system-prompt', layer: 'preset', kind: 'patch-value', source: 'test',
      yaml: { file: presetPatch, rowId: 'system-prompt', configKey: 'personaPrefix' },
      anchors: [{ file: presetPatch, line: 19, contains: 'personaPrefix:' }],
      note: 'n', description: '测试夹具条目的中文说明占位(登记铁律:description 必填非空)。', risks: ['r'], redLine: 'exempt', maxBytes: 65536,
      effect: { radius: 'immediate-new-session', note: '测试夹具占位:门禁扫描不消费生效半径(T2.2 起必填)' },
    },
    {
      id: 'test.rogue.pack.persona-prefix', layer: 'domain', kind: 'patch-value', source: 'test',
      yaml: { file: packPatch, rowId: 'system-prompt', configKey: 'personaPrefix' },
      anchors: [{ file: packPatch, line: 3, contains: 'personaPrefix:' }],
      note: 'n', description: '测试夹具条目的中文说明占位(登记铁律:description 必填非空)。', risks: ['r'], redLine: 'exempt', maxBytes: 65536,
      effect: { radius: 'immediate-new-session', note: '测试夹具占位:门禁扫描不消费生效半径(T2.2 起必填)' },
    },
    {
      id: 'test.rogue.pack.persona-md', layer: 'domain', kind: 'patch-value', source: 'test',
      anchors: [{ file: 'packs/rogue-pack/persona.md', line: 1, contains: '# persona' }],
      note: 'n', description: '测试夹具条目的中文说明占位(登记铁律:description 必填非空)。', risks: ['r'], redLine: 'exempt', maxBytes: 65536,
      effect: { radius: 'immediate-new-session', note: '测试夹具占位:门禁扫描不消费生效半径(T2.2 起必填)' },
    },
    {
      id: 'test.rogue.runtime.section', layer: 'runtime', kind: 'runtime-injection', source: 'test',
      anchors: [{ file: 'packages/eterna-rogue/src/index.ts', line: 2, contains: 'systemPrompt' }],
      note: 'n', description: '测试夹具条目的中文说明占位(登记铁律:description 必填非空)。', risks: ['r'], redLine: 'exempt', maxBytes: 65536,
      effect: { radius: 'immediate-new-session', note: '测试夹具占位:门禁扫描不消费生效半径(T2.2 起必填)' },
    },
  ]
}

describe('packctl prompt-scan 提示词登记铁律', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'packctl-prompt-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('方向 1|未登记被拦:patch 键(personaPrefix/prefix/section)、section 使用、packs persona 三个面各有 finding', () => {
    makeRogueRepo(dir)
    const findings = promptScan(dir)
    const codes = findings.map(f => f.code)
    expect(codes.filter(c => c === 'prompt/unregistered-prompt-key').length).toBeGreaterThanOrEqual(4)
    expect(codes).toContain('prompt/unregistered-section-usage')
    expect(codes).toContain('prompt/unregistered-pack-persona')
  })

  it('方向 2|登记后通过(注入登记元数据):同构造 + registry 条目 → 0 findings', () => {
    makeRogueRepo(dir)
    expect(promptScan(dir, { registry: rogueRegistry() })).toHaveLength(0)
  })

  it('方向 2|登记后通过(真实注册表对账):真实锚点路径的仓库事实 0 findings', () => {
    // preset 层:preset-standard 裸标量 prefix + preset-cordis >- 块标量 + planning/plan-mode section
    // 注:开发档 eterna-web/eterna-super 自 rc.5 起整文件豁免(RC5-P2-01,真值锚定
    // docker/profile/*.template);此处写 eterna-web 仍 0 findings,但 P1 由下一条
    // 「豁免只覆盖开发档」用例的非豁免 clone 兜底,本用例实际覆盖 packs/packages 真实锚点。
    writeFile(dir, 'profiles/eterna-web/cordis.patch.yml', [
      '- id: preset-cordis',
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      '          prefix: >-',
      '            You are a coding agent powered by the {{model}} model.',
      '      - id: planning',
      '        name: cordis:group',
      '        group: true',
      '        config:',
      '          - id: plan-mode',
      "            name: '@deepseek-ai/dsh-plan-mode'",
      '            config:',
      '              section: |',
      '                You are in plan mode.',
      '- id: preset-standard',
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      '          prefix: You are a coding agent powered by the {{model}} model.',
      '',
    ].join('\n'))
    // 领域层:packs personaPrefix(>- 块标量)+ persona.md 全文
    writeFile(dir, 'packs/event-planning/cordis.patch.yml', [
      '- id: system-prompt',
      '  config:',
      '    personaPrefix: >-',
      '      You are a senior event planning specialist.',
      '',
    ].join('\n'))
    writeFile(dir, 'packs/event-planning/persona.md', '# persona\n')
    // 运行时层:memory 直接调用 + glue inject 声明(两条命中模式各一)
    writeFile(dir, 'packages/memory/src/tools.ts',
      'export const dshHost = (ctx) => ({ registerPromptSection: (section) => ctx.systemPrompt.section(section) })\n')
    writeFile(dir, 'packages/glue/src/plugins/memory-plugin.ts',
      'export const plugin = { inject: { tools: true, systemPrompt: true, governance: false } }\n')
    expect(promptScan(dir)).toHaveLength(0)
  })

  it('误报防护:注释行/测试文件豁免;非 persona 插件的 prefix 不算提示词面', () => {
    writeFile(dir, 'packages/eterna-doc/src/index.ts', [
      '// 参考:上游用 ctx.systemPrompt.section(x) 注入',
      '/* systemPrompt: true 的 inject 声明也只是注释 */',
      'export const x = 1',
      '',
    ].join('\n'))
    writeFile(dir, 'packages/eterna-rogue/tests/route.spec.ts',
      'expect(() => ctx.systemPrompt.section(section)).toBeDefined()\n')
    writeFile(dir, 'profiles/clean-web/cordis.patch.yml', [
      '- id: preset-clean',
      '  config:',
      '    plugins:',
      '      - id: tool-custom',
      '        config:',
      '          prefix: /usr/local/share/prefix',
      '',
    ].join('\n'))
    expect(promptScan(dir)).toHaveLength(0)
  })

  it('白名单与豁免标注:精确文件豁免不报;缺 reason 的白名单条目本身出 warning', () => {
    // packages/prompt-studio/src/registry.ts 是既知豁免(anchors 含注入样例字面量,管理面非注入方)
    writeFile(dir, 'packages/prompt-studio/src/registry.ts',
      "{ file: 'packages/x/src/y.ts', line: 1, contains: 'ctx.systemPrompt.section(section)' },\n")
    expect(promptScan(dir)).toHaveLength(0)
    // rc.5:开发档 eterna-web/super 两精确文件豁免(B13 后真值锚定 docker/profile/*.template)
    expect(PROMPT_SCAN_WHITELIST.length).toBeGreaterThanOrEqual(4)
    const whitelistedPaths = PROMPT_SCAN_WHITELIST.map(e => e.path)
    expect(whitelistedPaths).toContain('profiles/eterna-web/cordis.patch.yml')
    expect(whitelistedPaths).toContain('profiles/eterna-super/cordis.patch.yml')

    // 豁免仍生效但缺标注 → warning(豁免决定必须可审查,不允许无声放行)
    const badlyAnnotated: readonly PromptWhitelistEntry[] = [
      { path: 'packages/prompt-studio/src/registry.ts', reason: ' ' },
    ]
    const findings = promptScan(dir, { whitelist: badlyAnnotated })
    const codes = findings.map(f => f.code)
    expect(codes).toContain('prompt/whitelist-without-reason')
    expect(codes).not.toContain('prompt/unregistered-section-usage')
    expect(findings.find(f => f.code === 'prompt/whitelist-without-reason')?.severity).toBe('warning')
  })

  it('白名单条目都是精确文件路径(无目录前缀/尾斜杠)且 reason 非空(T17/R19 防整目录盲区)', () => {
    for (const entry of PROMPT_SCAN_WHITELIST) {
      expect(/\.[a-z0-9]+$/i.test(entry.path), `${entry.path}:必须是精确文件路径(带扩展名)`).toBe(true)
      expect(entry.path.endsWith('/'), `${entry.path}:目录前缀豁免会重新制造模板/新增文件盲区`).toBe(false)
      expect(entry.reason.trim().length, `${entry.path}:豁免标注(reason)必填`).toBeGreaterThan(0)
    }
    // 目录前缀匹配已移除:注入目录级白名单条目不得顺带豁免其下文件(精确匹配语义回归)。
    writeFile(dir, 'profiles/eterna-web/cordis.patch.yml', [
      '- id: preset-cordis',
      '  config:',
      '    plugins:',
      '      - id: persona',
      '        config:',
      '          prefix: Rogue clone.',
      '',
    ].join('\n'))
    const directoryPrefix: readonly PromptWhitelistEntry[] = [
      { path: 'profiles/eterna-web/', reason: '目录前缀豁免应被精确匹配语义拒绝' },
    ]
    const findings = promptScan(dir, { whitelist: directoryPrefix })
    expect(findings.some(f => f.code === 'prompt/unregistered-prompt-key'
      && f.path.startsWith('profiles/eterna-web/cordis.patch.yml:'))).toBe(true)
  })

  it('真实仓(T17/R19):docker/profile 模板在扫描根内,模板扫描 0 findings', () => {
    // 真实仓事实:容器模板(prompt 真值源)+ 开发档精确豁免 + 模板键登记后全绿。
    expect(promptScan(REPO_ROOT)).toHaveLength(0)
    // 反向证明 docker/profile 确实在扫描面内:拷贝真实模板,塞入未登记键必须被拦。
    const template = readFileSync(join(REPO_ROOT, 'docker/profile/cordis.patch.yml.template'), 'utf8')
    writeFile(dir, 'docker/profile/cordis.patch.yml.template', template)
    expect(promptScan(dir)).toHaveLength(0)
    appendFileSync(join(dir, 'docker/profile/cordis.patch.yml.template'),
      '\n- id: extra-template-prompt\n  config:\n    personaPrefix: >-\n      Rogue template prompt.\n')
    const findings = promptScan(dir).filter(f => f.code === 'prompt/unregistered-prompt-key')
    expect(findings).toHaveLength(1)
    expect(findings[0]?.path.startsWith('docker/profile/cordis.patch.yml.template:')).toBe(true)
  })

  it('模板盲区:docker/profile/cordis.patch.yml(及 .template 命名)未登记 personaPrefix 命中 prompt/unregistered-prompt-key', () => {
    const fixture = [
      '- id: system-prompt',
      '  config:',
      '    personaPrefix: >-',
      '      Rogue docker-profile persona.',
      '',
    ].join('\n')
    // 任务夹具口径:临时仓 docker/profile/cordis.patch.yml(容器内 live patch 形态)
    writeFile(dir, 'docker/profile/cordis.patch.yml', fixture)
    const plain = promptScan(dir).filter(f => f.code === 'prompt/unregistered-prompt-key')
    expect(plain).toHaveLength(1)
    expect(plain[0]?.path.startsWith('docker/profile/')).toBe(true)
    // 模板命名同样在扫描面内(T17 的核心盲区:模板文件曾被文件名过滤漏掉)
    rmSync(join(dir, 'docker/profile'), { recursive: true, force: true })
    writeFile(dir, 'docker/profile/cordis.patch.yml.template', fixture)
    const templated = promptScan(dir).filter(f => f.code === 'prompt/unregistered-prompt-key')
    expect(templated).toHaveLength(1)
    expect(templated[0]?.path.startsWith('docker/profile/cordis.patch.yml.template:')).toBe(true)
  })

  it('真实模板副本:super 四键走同文镜像登记、ACP 一键走模板键登记(0 findings);docker/profile 无整目录豁免,换名 clone 被拦', () => {
    for (const name of ['cordis.patch.yml.template', 'cordis.super.patch.yml.template', 'cordis.acp.patch.yml.template']) {
      writeFile(dir, `docker/profile/${name}`, readFileSync(join(REPO_ROOT, 'docker/profile', name), 'utf8'))
    }
    expect(promptScan(dir)).toHaveLength(0)
    // 换名 clone(docker/profile 下没有整目录豁免)必须按未登记键拦下。
    const baseTemplate = readFileSync(join(REPO_ROOT, 'docker/profile/cordis.patch.yml.template'), 'utf8')
    writeFile(dir, 'docker/profile/cordis.clone.patch.yml.template', baseTemplate)
    const cloned = promptScan(dir).filter(f => f.code === 'prompt/unregistered-prompt-key')
    expect(cloned.length).toBeGreaterThanOrEqual(4)
    expect(cloned.every(f => f.path.startsWith('docker/profile/cordis.clone.patch.yml.template:'))).toBe(true)
  })

  it('豁免只覆盖 eterna-web/eterna-super 两开发档:同构造的未豁免 profile clone 仍报 unregistered-prompt-key', () => {
    const fixture = [
      '- id: preset-cordis',
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      '          prefix: >-',
      '            You are a coding agent powered by the {{model}} model.',
      '      - id: planning',
      '        name: cordis:group',
      '        config:',
      '          - id: plan-mode',
      "            name: '@deepseek-ai/dsh-plan-mode'",
      '            config:',
      '              section: |',
      '                You are in plan mode.',
      '',
    ].join('\n')
    writeFile(dir, 'profiles/eterna-web/cordis.patch.yml', fixture)
    writeFile(dir, 'profiles/eterna-super/cordis.patch.yml', fixture)
    expect(promptScan(dir)).toHaveLength(0)
    // 白名单是精确文件前缀,不是 profiles/ 目录级豁免:换名 clone 必须照常被拦。
    writeFile(dir, 'profiles/clean-web/cordis.patch.yml', fixture)
    const findings = promptScan(dir)
    const p1 = findings.filter(f => f.code === 'prompt/unregistered-prompt-key')
    expect(p1.length).toBeGreaterThanOrEqual(2)
    expect(p1.every(f => f.path.includes('profiles/clean-web/cordis.patch.yml'))).toBe(true)
  })

  it('CLI 形态:prompt-scan 违规仓库退出码 1 并打印 finding;干净仓库退出码 0', () => {
    makeRogueRepo(dir)
    const bad: string[] = []
    expect(runPack(['prompt-scan'], { cwd: dir, writeLine: line => bad.push(line) })).toBe(1)
    expect(bad.some(l => l.includes('prompt/unregistered-prompt-key'))).toBe(true)
    expect(bad.some(l => l.includes('prompt-scan: '))).toBe(true)

    const good: string[] = []
    expect(runPack(['prompt-scan'], { cwd: join(dir, 'definitely-missing'), writeLine: line => good.push(line) })).toBe(0)
    expect(good).toEqual(['prompt-scan: 0 finding(s)'])
  })
})
