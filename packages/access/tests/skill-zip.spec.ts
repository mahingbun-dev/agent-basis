/**
 * 技能 zip 读取器的安全边界:路径穿越/绝对路径/反斜杠/NUL/符号链接/
 * 加密/zip64/重复路径/炸弹与损坏条目。
 */
import { describe, expect, it } from 'vitest'
import { readSkillZip, SkillZipError, SKILL_ZIP_MAX_ENTRY_BYTES } from '../src/skill-zip.ts'
import { zipOf } from './zip-fixture.ts'

function expectZipError(zip: Buffer, pattern: RegExp): void {
  let error: unknown
  try {
    readSkillZip(zip)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(SkillZipError)
  expect((error as Error).message).toMatch(pattern)
}

describe('readSkillZip', () => {
  it('store 与 deflate 都能解出', () => {
    const files = readSkillZip(zipOf([
      { path: 'demo/SKILL.md', data: 'hello' },
      { path: 'demo/refs/a.txt', data: 'compressed '.repeat(50), method: 8 },
    ]))
    expect(files.map(file => file.path).sort()).toEqual(['demo/SKILL.md', 'demo/refs/a.txt'])
    expect(files.find(file => file.path.endsWith('a.txt'))?.data.toString()).toContain('compressed')
  })

  it('拒绝路径穿越、绝对路径、反斜杠与 NUL', () => {
    expectZipError(zipOf([{ path: '../evil/SKILL.md', data: 'x' }]), /路径非法/)
    expectZipError(zipOf([{ path: '/etc/passwd', data: 'x' }]), /绝对路径/)
    expectZipError(zipOf([{ path: 'a\\b.txt', data: 'x' }]), /反斜杠/)
    expectZipError(zipOf([{ path: 'a\0b.txt', data: 'x' }]), /NUL/)
  })

  it('拒绝符号链接条目与加密 zip', () => {
    expectZipError(zipOf([{ path: 'link', data: '/etc/passwd', mode: 0o120777 }]), /符号链接/)
    const encrypted = zipOf([{ path: 'a.txt', data: 'x' }])
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    encrypted.writeUInt16LE(0x1, central + 8)
    expectZipError(encrypted, /加密/)
  })

  it('拒绝 zip64 与大小超限声明', () => {
    const zip64 = zipOf([{ path: 'a.txt', data: 'x' }])
    zip64.writeUInt16LE(0xffff, zip64.length - 14)
    zip64.writeUInt16LE(0xffff, zip64.length - 12)
    expectZipError(zip64, /zip64/)

    const huge = zipOf([{ path: 'a.txt', data: 'x' }])
    const central = huge.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    huge.writeUInt32LE(SKILL_ZIP_MAX_ENTRY_BYTES + 1, central + 24)
    expectZipError(huge, /单个文件不能超过/)
  })

  it('拒绝大小写不敏感重复路径与损坏 CRC', () => {
    expectZipError(zipOf([
      { path: 'a/b.txt', data: 'one' },
      { path: 'A/b.txt', data: 'two' },
    ]), /路径重复/)

    const corrupted = zipOf([{ path: 'a.txt', data: 'hello' }])
    const central = corrupted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    corrupted.writeUInt32LE(0x12345678, central + 16)
    expectZipError(corrupted, /校验失败/)
  })

  it('跳过 __MACOSX 与 .DS_Store,全噪声时报错', () => {
    const files = readSkillZip(zipOf([
      { path: '__MACOSX/._SKILL.md', data: 'noise' },
      { path: 'demo/.DS_Store', data: 'noise' },
      { path: 'demo/SKILL.md', data: 'real' },
    ]))
    expect(files.map(file => file.path)).toEqual(['demo/SKILL.md'])
    expectZipError(zipOf([
      { path: '__MACOSX/._SKILL.md', data: 'noise' },
      { path: 'demo/.DS_Store', data: 'noise' },
    ]), /没有可安装的文件/)
  })

  it('空包与非法 zip 报错', () => {
    expectZipError(Buffer.alloc(0), /为空/)
    expectZipError(Buffer.from('not a zip'), /不是有效的 zip/)
  })
})
