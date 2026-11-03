/**
 * Cordis 纪律静态检查单测:CORD001 旁路全局(含注释豁免与行号)、
 * CORD002/003 可交换接口形态、CORD004 命名空间、CORD005 注册表唯一。
 */
import { describe, expect, it } from 'vitest'
import { lintServiceIdRegistry, lintToolModule } from '../src/cordis.ts'
import type { SkillFile } from '../src/pack.ts'

function toolSource(text: string, relPath = 'tools/x.ts'): SkillFile {
  return { relPath, absPath: `/${relPath}`, text }
}

describe('CORD001 无旁路全局', () => {
  it.each([
    ['process.env.API_KEY'],
    ['globalThis.cache'],
    ['setTimeout(fn, 100)'],
    ['setInterval(fn, 1000)'],
    ['setImmediate(fn)'],
  ])('检出 %s', (code) => {
    const { findings } = lintToolModule(toolSource(`const v = ${code}\n`), 'demo')
    expect(findings.some(f => f.code === 'CORD001')).toBe(true)
  })

  it('注释里的禁止词不误报(行注释 / 块注释 / URL 字符串)', () => {
    const source = [
      '// 不许用 process.env,配置走 Config',
      '/* globalThis 禁止 */',
      'const url = "https://example.com/a?b=1" // setImmediate 勿用',
      'export const X_SERVICE_ID = "@demo/x"',
      'export interface X { readonly id: typeof X_SERVICE_ID }',
      '',
    ].join('\n')
    const { findings } = lintToolModule(toolSource(source), 'demo')
    expect(findings.filter(f => f.code === 'CORD001')).toEqual([])
  })

  it('报告行号(path:line 形态)', () => {
    const source = 'export const A_SERVICE_ID = "@demo/a"\n\nconst v = process.env.X\n'
    const { findings } = lintToolModule(toolSource(source), 'demo')
    const hit = findings.find(f => f.code === 'CORD001')
    expect(hit?.path).toBe('tools/x.ts:3')
  })

  it('ctx 定时器形态不误报(ctx.setTimeout)', () => {
    const source = [
      'export const T_SERVICE_ID = "@demo/t"',
      'export interface T { readonly id: typeof T_SERVICE_ID }',
      'const start = (ctx: { setTimeout: (f: () => void, ms: number) => void }) => ctx.setTimeout(() => {}, 10)',
      'export const s = start',
      '',
    ].join('\n')
    const { findings } = lintToolModule(toolSource(source), 'demo')
    expect(findings.filter(f => f.code === 'CORD001')).toEqual([])
  })
})

describe('CORD002/003 可交换接口形态', () => {
  it('缺 SERVICE_ID 导出 → CORD002', () => {
    const { findings } = lintToolModule(toolSource('export const x = 1\n'), 'demo')
    expect(findings.map(f => f.code)).toContain('CORD002')
  })

  it('有 SERVICE_ID 但缺 readonly id 接口 → CORD003', () => {
    const source = 'export const X_SERVICE_ID = "@demo/x"\nexport interface X { ping(): void }\n'
    const { findings } = lintToolModule(toolSource(source), 'demo')
    expect(findings.map(f => f.code)).toContain('CORD003')
  })

  it('完整形态零发现', () => {
    const source = [
      'export const X_SERVICE_ID = "@demo/x"',
      'export interface X { readonly id: typeof X_SERVICE_ID }',
      '',
    ].join('\n')
    expect(lintToolModule(toolSource(source), 'demo').findings).toEqual([])
  })

  it('index.ts barrel 豁免形态检查', () => {
    const source = "export { createX } from './x.ts'\n"
    expect(lintToolModule(toolSource(source, 'tools/index.ts'), 'demo').findings).toEqual([])
  })
})

describe('CORD004 命名空间 / CORD005 注册表唯一', () => {
  it('SERVICE_ID 不在 @demo/ 下 → CORD004', () => {
    const source = [
      'export const X_SERVICE_ID = "@other/x"',
      'export interface X { readonly id: typeof X_SERVICE_ID }',
      '',
    ].join('\n')
    const { findings } = lintToolModule(toolSource(source), 'demo')
    expect(findings.map(f => f.code)).toContain('CORD004')
  })

  it('两个模块同 ID → CORD005', () => {
    const findings = lintServiceIdRegistry([
      { module: 'tools/a.ts', constName: 'A', value: '@demo/thing' },
      { module: 'tools/b.ts', constName: 'B', value: '@demo/thing' },
    ])
    expect(findings.map(f => f.code)).toContain('CORD005')
  })

  it('ID 不同 → 零发现', () => {
    const findings = lintServiceIdRegistry([
      { module: 'tools/a.ts', constName: 'A', value: '@demo/thing-a' },
      { module: 'tools/b.ts', constName: 'B', value: '@demo/thing-b' },
    ])
    expect(findings).toEqual([])
  })
})
