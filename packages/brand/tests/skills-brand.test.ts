/**
 * @eterna/brand skills 守卫(T21 B2):
 * - 基线 = 上游 dsh-v0.2.2-rc.5 `packages/preset/agent-preset/skills/dsh-doc`(43 文件);
 * - 16 个上游 references 全部同步;品牌增量(personal-tools.md + personal-tool 模板)在位;
 * - 品牌扫描:DeepSeek Harness 0 命中;裸 DSH 品牌词 0 命中
 *   (DSH_HOME/DSH_PROFILE* 等运行时标识符、__DSH_BOOT__ 与 @deepseek-ai/* 包名保留);
 * - 旧 4 个 skill 目录(alpha.3 基线)已被 dsh-doc 取代,不得残留重复入口。
 *
 * 升级姿势:上游 skills/ 变更时把新基线文件清单同步到 UPSTREAM_FILES 并重放品牌替换。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const skillsRoot = join(import.meta.dirname, '..', 'skills')
const skillRoot = join(skillsRoot, 'dsh-doc')

/** rc.5 dsh-doc 基线 43 文件(1 SKILL + 16 references + 26 templates)。 */
const UPSTREAM_FILES = [
  'SKILL.md',
  'references/artwork.md',
  'references/composition-reference.md',
  'references/compositions.md',
  'references/configuration.md',
  'references/host-plugin.md',
  'references/locate-docs.md',
  'references/mcp-bundle.md',
  'references/packages.md',
  'references/plugin-details.md',
  'references/plugin-development.md',
  'references/practices.md',
  'references/tool-design.md',
  'references/ui-plugin.md',
  'references/upgrading.md',
  'references/user-actions.md',
  'references/verification.md',
  'templates/decoration/client.js',
  'templates/decoration/cordis.patch.yml',
  'templates/decoration/docs/DETAIL.md',
  'templates/decoration/docs/preview.svg',
  'templates/decoration/icon.svg',
  'templates/decoration/index.js',
  'templates/decoration/locale/de.json',
  'templates/decoration/locale/en.json',
  'templates/decoration/locale/es.json',
  'templates/decoration/locale/fr.json',
  'templates/decoration/locale/ja.json',
  'templates/decoration/locale/pt.json',
  'templates/decoration/locale/ru.json',
  'templates/decoration/package.json',
  'templates/mcp/cordis.patch.yml',
  'templates/mcp/docs/DETAIL.md',
  'templates/mcp/docs/preview.svg',
  'templates/mcp/icon.svg',
  'templates/mcp/locale/de.json',
  'templates/mcp/locale/en.json',
  'templates/mcp/locale/es.json',
  'templates/mcp/locale/fr.json',
  'templates/mcp/locale/ja.json',
  'templates/mcp/locale/pt.json',
  'templates/mcp/locale/ru.json',
  'templates/mcp/package.json',
] as const

/** 本部署品牌增量(非上游文件;重放时保留)。 */
const BRAND_FILES = [
  'references/personal-tools.md',
  'templates/personal-tool/package.json',
  'templates/personal-tool/index.js',
] as const

/** 已被 dsh-doc 取代的 alpha.3 基线 skill 目录。 */
const SUPERSEDED_SKILLS = [
  'agent-experience',
  'cordis-composition-reference',
  'cordis-plugin-development',
  'editing-cordis-compositions',
] as const

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

const skillFiles = walk(skillRoot).map(path => relative(skillRoot, path).split('\\').join('/'))

describe('brand skills: rc.5 dsh-doc 基线', () => {
  it('43 个上游文件全部在位(路径逐一对齐)', () => {
    expect(UPSTREAM_FILES).toHaveLength(43)
    for (const file of UPSTREAM_FILES) {
      expect(existsSync(join(skillRoot, file)), `missing ${file}`).toBe(true)
    }
  })

  it('16 个上游 references 同步,另有 1 份本部署增量', () => {
    const upstreamRefs = UPSTREAM_FILES.filter(file => file.startsWith('references/'))
    expect(upstreamRefs).toHaveLength(16)
    const brandRefs = skillFiles.filter(file => file.startsWith('references/'))
    expect(brandRefs.sort()).toEqual([...upstreamRefs, 'references/personal-tools.md'].sort())
  })

  it('品牌增量文件在位(personal-tools 契约 + 最小模板)', () => {
    for (const file of BRAND_FILES) {
      expect(existsSync(join(skillRoot, file)), `missing ${file}`).toBe(true)
    }
    const contract = readFileSync(join(skillRoot, 'references/personal-tools.md'), 'utf8')
    expect(contract).toContain('install_personal_plugin')
  })

  it('SKILL.md frontmatter name=dsh-doc,且 Read next 覆盖个人工具增量', () => {
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
    expect(skill.startsWith('---\nname: dsh-doc\n')).toBe(true)
    expect(skill).toContain('references/personal-tools.md')
    expect(skill).toContain('templates/personal-tool/')
    expect(skill).toContain('install_personal_plugin')
  })

  it('旧 4 个 skill 目录已移除(不残留重复入口)', () => {
    for (const name of SUPERSEDED_SKILLS) {
      expect(existsSync(join(skillsRoot, name)), `stale skill dir ${name}`).toBe(false)
    }
  })

  it('文档中引用的 references/templates 路径全部存在(上游 skills.spec 同款)', () => {
    for (const file of skillFiles) {
      const text = readFileSync(join(skillRoot, file), 'utf8')
      for (const match of text.matchAll(/`((?:references|templates)\/[^`]+)`/g)) {
        const cited = match[1] ?? ''
        expect(existsSync(join(skillRoot, cited)), `${file}: ${cited}`).toBe(true)
      }
    }
  })

  it('文档不提退休 skill 名(上游 rc.5 把 4 skill 收敛为 dsh-doc)', () => {
    const retired = /cordis-plugin-development|editing-cordis-compositions|cordis-composition-reference|agent-experience/u
    const hits = skillFiles.filter(file => retired.test(readFileSync(join(skillRoot, file), 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('brand skills: 品牌扫描 0 命中', () => {
  const files = walk(skillsRoot)

  it('DeepSeek Harness 0 命中', () => {
    const hits = files.filter(file => readFileSync(file, 'utf8').includes('DeepSeek Harness'))
    expect(hits.map(file => relative(skillsRoot, file))).toEqual([])
  })

  it('裸 DSH 品牌词 0 命中(标识符/包名豁免)', () => {
    // 词位边界:DSH_HOME / DSH_PROFILE* / DSH_INSTALL_DIR / DSH_NODE_EXECUTABLE /
    // __DSH_BOOT__ 与 @deepseek-ai/dsh-* 中的 DSH 不算品牌词(均为真实运行时标识符)。
    const standalone = /(?<![A-Za-z0-9_$@-])DSH(?![A-Za-z0-9_-])/
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (standalone.test(text)) hits.push(relative(skillsRoot, file))
    }
    expect(hits).toEqual([])
  })

  it('裸 DSH 标识符保留(证明扫描未误伤真实变量名)', () => {
    const contract = readFileSync(join(skillRoot, 'references/personal-tools.md'), 'utf8')
    expect(contract).toContain('$DSH_HOME')
    expect(readFileSync(join(skillRoot, 'references/locate-docs.md'), 'utf8')).toContain('DSH_INSTALL_DIR')
  })
})
