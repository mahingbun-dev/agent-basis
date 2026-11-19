/**
 * form-check(G0-6,40 号 S-2)四类红绿用例 + 用法错误(退出码 2)。
 * 全部真实落盘临时仓库(agent-basis 验收门要求真实运行;不 mock 文件系统)。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { extractEternaMountRows, formCheck, resolveFormCheckRoot } from '../src/form.ts'
import { runPack } from '../src/cli.ts'
import { makeTmpRoot } from './helpers.ts'

const tmp = makeTmpRoot('packctl-form-')
afterAll(() => { tmp.cleanup() })

/** 挂载行 fixture 形态:insert 块内的 @eterna 行;preset 组内嵌行必须被排除。 */
function formPatchText(rows: readonly [id: string, name: string][]): string {
  const rowLines = rows.map(([id, name]) => `    - id: ${id}\n      name: '@eterna/${name}'`).join('\n')
  return [
    '# fixture patch(form.spec.ts)',
    '- id: preset-x',
    '  config:',
    '    plugins:',
    '      - id: nested-eterna-row',
    "        name: '@eterna/should-not-count'",
    '- insert:',
    rowLines,
    '- id: llm-pi-ai',
    '  config: {}',
    '',
  ].join('\n')
}

interface RepoSpec {
  readonly tier1?: readonly string[]
  readonly tier2?: readonly string[]
  readonly sources?: Readonly<Record<string, string>>
  readonly baseTemplateRows?: readonly [string, string][]
  readonly baseListRows?: readonly [string, string][]
  readonly superTemplateRows?: readonly [string, string][]
  readonly superListRows?: readonly [string, string][]
  readonly omitSuperTemplate?: boolean
}

/** 构造一个最小可检仓库(docs/tiers.yml + tier1 包源码 + 两形态四工件)。 */
function makeRepo(name: string, spec: RepoSpec): string {
  const root = join(tmp.root, name)
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'tiers.yml'),
    `tier1:\n${(spec.tier1 ?? ['alpha']).map(n => `  - ${n}`).join('\n')}\ntier2:\n${(spec.tier2 ?? ['tasks']).map(n => `  - ${n}`).join('\n')}\n`)
  for (const [pkg, source] of Object.entries(spec.sources ?? { alpha: 'export const x = 1\n' })) {
    mkdirSync(join(root, 'packages', pkg, 'src'), { recursive: true })
    writeFileSync(join(root, 'packages', pkg, 'package.json'), JSON.stringify({ name: `@eterna/${pkg}`, private: true }, null, 2))
    writeFileSync(join(root, 'packages', pkg, 'src', 'main.ts'), source)
  }
  mkdirSync(join(root, 'docker', 'profile'), { recursive: true })
  mkdirSync(join(root, 'profiles', 'eterna-web'), { recursive: true })
  mkdirSync(join(root, 'profiles', 'eterna-super'), { recursive: true })
  writeFileSync(join(root, 'docker', 'profile', 'cordis.patch.yml.template'), formPatchText(spec.baseTemplateRows ?? [['eterna-alpha', 'alpha']]))
  writeFileSync(join(root, 'profiles', 'eterna-web', 'cordis.patch.yml'), formPatchText(spec.baseListRows ?? [['eterna-alpha', 'alpha']]))
  if (spec.omitSuperTemplate !== true) {
    writeFileSync(join(root, 'docker', 'profile', 'cordis.super.patch.yml.template'), formPatchText(spec.superTemplateRows ?? [['eterna-alpha', 'alpha']]))
  }
  writeFileSync(join(root, 'profiles', 'eterna-super', 'cordis.patch.yml'), formPatchText(spec.superListRows ?? [['eterna-alpha', 'alpha']]))
  return root
}

function run(root: string, args: readonly string[] = ['form-check']) {
  const lines: string[] = []
  const code = runPack(args, { cwd: root, writeLine: line => lines.push(line) })
  return { code, out: lines.join('\n') }
}

describe('判定则 ①: Tier 真值源(退出码 2)', () => {
  it('docs/tiers.yml 缺失 → usageError(formCheck 纯函数层;CLI 层因模块位置回退不再可达)', () => {
    const root = join(tmp.root, 'no-tiers')
    mkdirSync(join(root, 'packages'), { recursive: true })
    const outcome = formCheck(root)
    expect(outcome.usageError).toContain('真值源缺失')
    expect(outcome.findings).toEqual([])
  })

  it('仓库根解析: cwd 链命中优先;cwd 在仓库外时回退 packctl 所属仓库', () => {
    const moduleDir = dirname(fileURLToPath(import.meta.url)) // <repo>/tools/packctl/tests
    // cwd 在仓库子目录(自身无 docs/tiers.yml,需向上查找) → 解析到含真值源的祖先
    const inRepo = resolveFormCheckRoot(join(moduleDir, '..', 'src'), moduleDir)
    expect(existsSync(join(inRepo, 'docs', 'tiers.yml'))).toBe(true)
    // fixture 仓库根(cwd 链命中) → 原 cwd 行为不变
    const fixture = makeRepo('resolve-fixture', {})
    expect(resolveFormCheckRoot(fixture, moduleDir)).toBe(fixture)
    // cwd 在仓库外 → 回退到 packctl 所属仓库,而非误报真值源缺失
    const outside = resolveFormCheckRoot(join(tmp.root, 'no-tiers'), moduleDir)
    expect(existsSync(join(outside, 'docs', 'tiers.yml'))).toBe(true)
    expect(outside).not.toBe(join(tmp.root, 'no-tiers'))
  })

  it('CLI: 仓库外 cwd 运行 form-check → 不报「真值源缺失」,退出码不为 2', () => {
    const root = join(tmp.root, 'no-tiers')
    mkdirSync(join(root, 'packages'), { recursive: true })
    const { code, out } = run(root)
    expect(out).not.toContain('真值源缺失')
    expect(code).not.toBe(2)
  })

  it('tier1 条目不实存 → 2(未落地名只允许登记在 tier2)', () => {
    const root = makeRepo('ghost-tier1', { tier1: ['alpha', 'ghost'] })
    const { code, out } = run(root)
    expect(code).toBe(2)
    expect(out).toContain('不实存')
  })
})

describe('TIER001: Tier1 不得 import Tier2', () => {
  it('红: 裸名 @eterna/tasks → ERROR TIER001,退出 1', () => {
    const root = makeRepo('tier-red', { sources: { alpha: "import { t } from '@eterna/tasks'\nexport const x = t\n" } })
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain('ERROR TIER001')
    expect(out).toContain('@eterna/tasks')
  })

  it('红: 相对路径穿越包边界(../../tasks/…) → ERROR TIER001', () => {
    const root = makeRepo('tier-red-rel', { sources: { alpha: "import '@eterna/alpha/sub'\nexport { core } from '../../tasks/src/core'\n" } })
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain('ERROR TIER001')
    expect(out).toContain('tasks/src/core')
  })

  it('绿: 同包相对导入与 Tier1 间互导 → 0 finding,退出 0', () => {
    const root = makeRepo('tier-green', {
      tier1: ['alpha', 'glue'],
      sources: {
        alpha: "import { helper } from './helper'\nimport { g } from '@eterna/glue'\nexport const x = helper + g\n",
        glue: 'export const g = 2\n',
      },
    })
    writeFileSync(join(root, 'packages', 'alpha', 'src', 'helper.ts'), 'export const helper = 1\n')
    const { code, out } = run(root, ['form-check', '--enforce-pair-drift'])
    expect(code).toBe(0)
    expect(out).toContain('form-check: 0 finding(s)(0 error)')
  })
})

describe('FORM001: 挂载清单与模板一致 + base ⊆ super 超集', () => {
  it('绿: 两形态清单=模板且 base⊆super → 0 finding,退出 0(--enforce-pair-drift 下)', () => {
    const root = makeRepo('form-green', {
      superTemplateRows: [['eterna-alpha', 'alpha'], ['eterna-tasks', 'tasks']],
      superListRows: [['eterna-alpha', 'alpha'], ['eterna-tasks', 'tasks']],
    })
    const { code, out } = run(root, ['form-check', '--enforce-pair-drift'])
    expect(code).toBe(0)
    expect(out).toContain('form-check: 0 finding(s)(0 error)')
  })

  it('红·增: 清单多一行 → 默认 ERROR 退出 1(ENFORCE_PAIR_DRIFT=true,base 对同步合入后语义);显式 false 仍可 WARNING 登记', () => {
    const root = makeRepo('form-red-add', {
      baseListRows: [['eterna-alpha', 'alpha'], ['eterna-extra', 'extra']],
      superTemplateRows: [['eterna-alpha', 'alpha'], ['eterna-extra', 'extra']],
      superListRows: [['eterna-alpha', 'alpha'], ['eterna-extra', 'extra']],
    })
    // 缺省(ENFORCE_PAIR_DRIFT=true,40 号 §8 风险 1):漂移即 ERROR、退出 1。
    const strict = run(root)
    expect(strict.code).toBe(1)
    expect(strict.out).toContain('ERROR FORM001')
    expect(strict.out).toContain('清单独有')
    // --enforce-pair-drift 旗标保留为显式复跑口径(与缺省同向,见 cli.ts cmdFormCheck)。
    const flag = run(root, ['form-check', '--enforce-pair-drift'])
    expect(flag.code).toBe(1)
    expect(flag.out).toContain('ERROR FORM001')
    // 显式登记路径:库层显式传 enforcePairDrift:false → WARNING、不置退出码。
    const lenient = formCheck(root, { enforcePairDrift: false })
    expect(lenient.findings.map(f => f.severity)).toEqual(['warning'])
    expect(lenient.findings[0]?.message).toContain('清单独有')
  })

  it('红·删: 清单少一行(模板独有) → ERROR(--enforce)', () => {
    const root = makeRepo('form-red-del', {
      baseListRows: [],
      superListRows: [],
    })
    const strict = run(root, ['form-check', '--enforce-pair-drift'])
    expect(strict.code).toBe(1)
    expect(strict.out).toContain('ERROR FORM001')
    expect(strict.out).toContain('模板独有')
  })

  it('红·换序: 行序不一致 → ERROR(--enforce)', () => {
    const root = makeRepo('form-red-order', {
      baseTemplateRows: [['eterna-alpha', 'alpha'], ['eterna-beta', 'beta']],
      baseListRows: [['eterna-beta', 'beta'], ['eterna-alpha', 'alpha']],
      superTemplateRows: [['eterna-alpha', 'alpha'], ['eterna-beta', 'beta']],
      superListRows: [['eterna-beta', 'beta'], ['eterna-alpha', 'alpha']],
    })
    const strict = run(root, ['form-check', '--enforce-pair-drift'])
    expect(strict.code).toBe(1)
    expect(strict.out).toContain('ERROR FORM001')
    expect(strict.out).toContain('顺序冲突')
  })

  it('红·超集: base 模板行不在 super 模板 → 恒 ERROR(无需旗标),退出 1', () => {
    const root = makeRepo('form-red-superset', {
      superTemplateRows: [['eterna-other', 'other']],
      superListRows: [['eterna-other', 'other']],
    })
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain('ERROR FORM001')
    expect(out).toContain('超集断言失败')
  })

  it('红·工件缺失: super 模板不存在 → 恒 ERROR,退出 1', () => {
    const root = makeRepo('form-red-missing', { omitSuperTemplate: true })
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain('ERROR FORM001')
    expect(out).toContain('形态工件缺失')
  })
})

describe('挂载行提取(extractEternaMountRows)单元口径', () => {
  it('只收 insert 块内 @eterna 行;preset 组内嵌行与非 @eterna 行不收', () => {
    const rows = extractEternaMountRows(formPatchText([['eterna-alpha', 'alpha'], ['eterna-beta', 'beta']]))
    expect(rows).toEqual([
      { id: 'eterna-alpha', name: '@eterna/alpha' },
      { id: 'eterna-beta', name: '@eterna/beta' },
    ])
  })
})
