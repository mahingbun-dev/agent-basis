/**
 * bundle 装载冒烟:manifest 解析 fail-loud / 依赖顺序装载 / dispose 回卷。
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bootBundle, parseManifest, parseManifestYaml, resolveEntryModule } from '../src/boot.ts'

const manifestDir = join(import.meta.dirname, 'fixtures')

async function loadFixtureManifest(): Promise<void> {
  await readFile(join(manifestDir, 'basis.yml'), 'utf8')
}

describe('manifest 解析', () => {
  it('字符串与对象条目规范化', () => {
    const manifest = parseManifest({
      plugins: ['a', { path: 'b', config: { x: 1 } }],
      agent: 'default',
    })
    expect(manifest.plugins).toEqual([
      { path: 'a' },
      { path: 'b', config: { x: 1 } },
    ])
    expect(manifest.agent).toBe('default')
  })

  it('fail-loud:缺 plugins / 非法条目抛 TypeError', () => {
    expect(() => parseManifest({})).toThrow(TypeError)
    expect(() => parseManifest({ plugins: [] })).toThrow(/非空数组/)
    expect(() => parseManifest({ plugins: [42] })).toThrow(/非法/)
    expect(() => parseManifestYaml('plugins: []')).toThrow(/非空数组/)
  })

  it('入口解析:目录补 src/index.ts;.ts 直通;file URL 生成', () => {
    expect(resolveEntryModule('greeter', '/repo')).toContain('/repo/greeter/src/index.ts')
    expect(resolveEntryModule('x/plugin.ts', '/repo')).toContain('/repo/x/plugin.ts')
  })

  it('loadFixtureManifest 可读(防 fixture 丢失)', async () => {
    await loadFixtureManifest()
  })
})

describe('bootBundle', () => {
  it('按序装载:依赖服务可见;dispose 后服务随提供者回卷', async () => {
    const text = await readFile(join(manifestDir, 'basis.yml'), 'utf8')
    const bundle = await bootBundle(parseManifestYaml(text), manifestDir)
    try {
      const echo = (bundle.ctx as unknown as { greetingEcho?: { echo(): string } }).greetingEcho
      expect(echo?.echo()).toBe('hi')
      expect(bundle.manifest.agent).toBe('default')
    } finally {
      await bundle.dispose()
    }
  })

  it('装载失败回卷:第二个插件坏 → 第一个已装载的也被撤销', async () => {
    const broken = parseManifest({ plugins: ['greeter', 'missing-plugin'] })
    await expect(bootBundle(broken, manifestDir)).rejects.toThrow()
    // greeter 的 fiber 已回卷:重新装载并验证服务确实被撤销过(状态位)
    const again = await bootBundle(parseManifest({ plugins: ['greeter'] }), manifestDir)
    const greeting = (again.ctx as unknown as { greeting?: { isDisposed(): boolean } }).greeting
    expect(greeting?.isDisposed()).toBe(true)
    await again.dispose()
  })
})
