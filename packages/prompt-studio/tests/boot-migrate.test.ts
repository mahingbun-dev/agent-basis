/**
 * boot 期工坊托管值移植脚本测试(docker/profile/migrate-prompt-edits.mjs,2026-11-18):
 *
 * 背景:entrypoint 哈希门控重渲染 cordis.patch.yml 时,窄移植只搬 disabled: 标记
 * /追加块/manifest 块,工坊写进 preset-standard/preset-cordis 行的 persona.prefix /
 * plan-mode.section / agent-instructions.maxBytes 被模板默认覆盖(0.1.13→0.1.14
 * 升级实证丢编辑)。移植脚本经「基线快照(模板默认值)vs 旧文件值」判定用户编辑。
 *
 * 测法:spawnSync 子进程跑真脚本(process.execPath,node:24 原生 strip-only——与
 * 容器内 boot 同一运行方式,连 .ts import 链一起验);模板用仓内真实 base/super
 * 两份。因此本套件兼作「注册表 6 条托管键 ↔ 两模板结构」的漂移守卫——此前
 * registry.test.ts 只钉 live 开发档行锚、packctl FORM001 只比挂载行,模板侧结构
 * 漂移无人看守,脚本定位 fail-closed 会在场景 1/5 首先炸出。
 *
 * 场景:①等值零移植+基线建立;②用户编辑移植(persona+maxBytes,基线在册);
 * ③基线漂移保护(旧默认≠新默认且未编辑→不移植,保基线升级传播——本机制存在的
 * 理由);④基线坏 json→回退「旧文件 vs 新模板」对比;⑤super 模板 6 条全命中;
 * ⑥prev 缺 preset-cordis 块→该条跳过、其余照常;⑦fatal(缺参/模板不可读)。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildNextEntryFileText, entrySpanOf, selfCheckEntryWrite } from '../src/entry-patch.ts'
import { findTopLevelRow, PROMPT_REGISTRY_ENTRIES, readYamlValueAtLine, WEB_PATCH } from '../src/registry.ts'
import type { PromptRegistryEntry } from '../src/registry.ts'
import { rmRetry } from './rm-retry.ts'

const SCRIPT = fileURLToPath(new URL('../../../docker/profile/migrate-prompt-edits.mjs', import.meta.url))
const TPL_BASE = fileURLToPath(new URL('../../../docker/profile/cordis.patch.yml.template', import.meta.url))
const TPL_SUPER = fileURLToPath(new URL('../../../docker/profile/cordis.super.patch.yml.template', import.meta.url))

/** 与脚本同口径的托管键清单(注册表单一事实源;恰好 6 条 preset 条目)。 */
const MANAGED = PROMPT_REGISTRY_ENTRIES.filter(
  entry => entry.kind === 'patch-value' && entry.yaml !== undefined && entry.yaml.file === WEB_PATCH,
)

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ps-boot-migrate-')) })
afterEach(async () => { await rmRetry(dir) })

/** 复刻脚本的值提取(同 entrySpanOf/readYamlValueAtLine,断言用同一口径)。 */
function extractValues(text: string): Record<string, string | null> {
  const lines = text.split('\n')
  const out: Record<string, string | null> = {}
  for (const entry of MANAGED) {
    try { out[entry.id] = readYamlValueAtLine(lines, entrySpanOf(entry, lines).keyIndex) ?? null } catch { out[entry.id] = null }
  }
  return out
}

/** 经工坊写侧纯函数构造「用户编辑后的旧文件」(与真实保存链同一变换)。 */
function applyEdit(entryId: string, baseText: string, nextText: string): string {
  const entry = MANAGED.find(e => e.id === entryId) as PromptRegistryEntry
  const next = buildNextEntryFileText(entry, baseText, nextText)
  selfCheckEntryWrite(entry, baseText, next, nextText)
  return next
}

function runScript(tplPath: string, prevArg: string, dstPath: string, baselinePath: string): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync(process.execPath, [SCRIPT, tplPath, prevArg, dstPath, baselinePath], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const tplText = (): string => readFileSync(TPL_BASE, 'utf8')
const tplValues = (): Record<string, string | null> => extractValues(tplText())

const PERSONA_ID = 'preset.standard.persona'
const PERSONA_EDIT = '迁移测试 persona:用户在工坊改过的自定义正文,含 {{model}} 占位与中文。\n第二行正文。'

describe('boot 期工坊托管值移植脚本(migrate-prompt-edits.mjs)', () => {
  it('① 等值零移植+基线建立:prev=模板拷贝、基线缺席 → dst 字节不动,基线按模板写出 6 条非空值', () => {
    const dst = join(dir, 'cordis.patch.yml')
    const prev = join(dir, 'prev.yml')
    const baseline = join(dir, 'baseline.json')
    writeFileSync(dst, tplText())
    writeFileSync(prev, tplText())
    const result = runScript(TPL_BASE, prev, dst, baseline)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('移植 0 处')
    expect(readFileSync(dst, 'utf8')).toBe(tplText())
    const written = JSON.parse(readFileSync(baseline, 'utf8')) as { schemaVersion: number; values: Record<string, string | null> }
    expect(written.schemaVersion).toBe(1)
    expect(Object.keys(written.values).sort()).toEqual(MANAGED.map(e => e.id).sort())
    expect(written.values).toEqual(tplValues())
    expect(Object.values(written.values).every(v => typeof v === 'string' && v.length > 0)).toBe(true)
  }, 30000)

  it('② 用户编辑移植:persona+maxBytes 两处改过(基线在册)→ 搬进新渲染,其余 4 条保模板,基线仍记模板值', () => {
    const base = tplText()
    const prevEdited = applyEdit('preset.standard.agent-instructions', applyEdit(PERSONA_ID, base, PERSONA_EDIT), '131072')
    const dst = join(dir, 'cordis.patch.yml')
    const prev = join(dir, 'prev.yml')
    const baseline = join(dir, 'baseline.json')
    writeFileSync(dst, base)
    writeFileSync(prev, prevEdited)
    writeFileSync(baseline, `${JSON.stringify({ schemaVersion: 1, values: tplValues() })}\n`)
    const result = runScript(TPL_BASE, prev, dst, baseline)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('移植 2 处')
    const after = extractValues(readFileSync(dst, 'utf8'))
    expect(after[PERSONA_ID]).toBe(PERSONA_EDIT) // 块标量整块替换 + round-trip 等值
    expect(after['preset.standard.agent-instructions']).toBe('131072') // 数值标量保型
    for (const [id, value] of Object.entries(tplValues())) {
      if (id !== PERSONA_ID && id !== 'preset.standard.agent-instructions') expect(after[id]).toBe(value)
    }
    const written = JSON.parse(readFileSync(baseline, 'utf8')) as { values: Record<string, string | null> }
    expect(written.values).toEqual(tplValues()) // 基线永远取自模板,不吸收用户编辑
  }, 30000)

  it('③ 基线漂移保护:旧文件=旧模板默认、基线记旧默认、新模板已改默认 → 不移植,新基线落地', () => {
    const base = tplText()
    const newDefault = tplValues()[PERSONA_ID] as string
    const oldDefault = '旧一代模板的默认 persona 正文(用户从未在工坊编辑过)'
    const dst = join(dir, 'cordis.patch.yml')
    const prev = join(dir, 'prev.yml')
    const baseline = join(dir, 'baseline.json')
    writeFileSync(dst, base)
    writeFileSync(prev, applyEdit(PERSONA_ID, base, oldDefault))
    writeFileSync(baseline, `${JSON.stringify({ schemaVersion: 1, values: { ...tplValues(), [PERSONA_ID]: oldDefault } })}\n`)
    const result = runScript(TPL_BASE, prev, dst, baseline)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('移植 0 处')
    expect(readFileSync(dst, 'utf8')).toBe(base) // 逐字节不动:模板侧基线升级照常传播
    expect(extractValues(readFileSync(dst, 'utf8'))[PERSONA_ID]).toBe(newDefault)
  }, 30000)

  it('④ 基线坏 json → 回退「旧文件 vs 新模板」对比:用户编辑照常移植(存量卷首启的一次性口径)', () => {
    const base = tplText()
    const dst = join(dir, 'cordis.patch.yml')
    const prev = join(dir, 'prev.yml')
    const baseline = join(dir, 'baseline.json')
    writeFileSync(dst, base)
    writeFileSync(prev, applyEdit(PERSONA_ID, base, PERSONA_EDIT))
    writeFileSync(baseline, '{broken json')
    const result = runScript(TPL_BASE, prev, dst, baseline)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('移植 1 处')
    expect(extractValues(readFileSync(dst, 'utf8'))[PERSONA_ID]).toBe(PERSONA_EDIT)
    const written = JSON.parse(readFileSync(baseline, 'utf8')) as { values: Record<string, string | null> }
    expect(written.values).toEqual(tplValues()) // 回填后下一轮起判定恢复精确
  }, 30000)

  // super 模板现阶段是 super 形态分支的在途文件(未跟踪,CI 检出不存在)——
  // 缺席即跳过本场景;super 形态合入 main 后守卫自动激活。
  it.skipIf(!existsSync(TPL_SUPER))('⑤ super 模板:6 条托管键全命中(兼模板结构漂移守卫),仅回填基线模式 dst 不动', () => {
    const superText = readFileSync(TPL_SUPER, 'utf8')
    const dst = join(dir, 'cordis.patch.yml')
    const baseline = join(dir, 'baseline.json')
    writeFileSync(dst, superText)
    const result = runScript(TPL_SUPER, '--', dst, baseline)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('移植 0 处')
    expect(readFileSync(dst, 'utf8')).toBe(superText)
    const written = JSON.parse(readFileSync(baseline, 'utf8')) as { values: Record<string, string | null> }
    expect(written.values).toEqual(extractValues(superText))
    expect(Object.values(written.values).every(v => typeof v === 'string' && v.length > 0)).toBe(true)
  }, 30000)

  it('⑥ prev 缺 preset-cordis 块 → 该二条静默跳过,preset-standard 编辑照常移植', () => {
    const base = tplText()
    const lines = base.split('\n')
    const span = findTopLevelRow(lines, 'preset-cordis')
    expect(span).toBeDefined()
    const withoutCordis = [...lines.slice(0, span!.start), ...lines.slice(span!.end)].join('\n')
    const prevEdited = applyEdit(PERSONA_ID, withoutCordis, PERSONA_EDIT)
    const dst = join(dir, 'cordis.patch.yml')
    const prev = join(dir, 'prev.yml')
    const baseline = join(dir, 'baseline.json')
    writeFileSync(dst, base)
    writeFileSync(prev, prevEdited)
    writeFileSync(baseline, `${JSON.stringify({ schemaVersion: 1, values: tplValues() })}\n`)
    const result = runScript(TPL_BASE, prev, dst, baseline)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('移植 1 处')
    const after = extractValues(readFileSync(dst, 'utf8'))
    expect(after[PERSONA_ID]).toBe(PERSONA_EDIT)
    expect(after['preset.cordis.persona']).toBe(tplValues()['preset.cordis.persona'])
  }, 30000)

  it('⑦ fatal:缺参/模板不可读 → exit 1 + 成因明示,不产基线', () => {
    const noArgs = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(noArgs.status).toBe(1)
    expect(noArgs.stderr).toContain('用法')
    const baseline = join(dir, 'baseline.json')
    const missing = runScript(join(dir, 'no-such-template.yml'), '--', join(dir, 'dst.yml'), baseline)
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('不可读')
    expect(existsSync(baseline)).toBe(false)
  }, 30000)
})
