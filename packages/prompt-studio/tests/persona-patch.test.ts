/**
 * persona patch 读写单测(真实 fs,临时目录):
 * - 定位 preset-standard 行内唯一 prefix 行(fail-closed:0/≥2 报错;无行报错);
 * - 单/双引号 YAML 标量反引;双引号转义写(\n \" \\ 控制字符);
 * - 纯文本变换:除 prefix 行外逐字节不变(!!js 行保真——spike §4.1 铁律);
 * - 原子写 + verify 失败自动还原 + 无 .tmp/.bak 残留;单写者串行。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PersonaPatchFile, buildNextPatchText, locatePrefixLine, nodePersonaPatchIo, selfCheckNextPatchText,
  unquoteYamlScalar, yamlDoubleQuoted,
} from '../src/persona-patch.ts'

const MARKER = 'T7_SPIKE_PERSONA_MARKER_B eterna spike persona beta'

/** 模拟 spike 生成的 profile patch 层结构(含 !!js 行与 preset-standard 行)。 */
function fixturePatch(persona: string): string {
  return [
    '# T7.0 spike patch layer — persona 前缀为被测值(由 scripts/t7-spike-verify.mjs 生成)。',
    '- insert:',
    '    - id: eterna-llm',
    "      name: '@eterna/llm-openai'",
    '      config:',
    "        baseURL: 'https://api.xiaomimimo.com/v1'",
    '        apiKeyEnv: MIMO_API_KEY',
    "        provider: 'eterna'",
    '        models:',
    '          - id: deepseek-flash',
    '',
    '- id: llm-deepseek',
    '  disabled: true',
    '- id: preset-standard',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    id: standard',
    '    order: 1',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    `          prefix: '${persona}'`,
    '      - id: agent-instructions',
    "        name: '@deepseek-ai/dsh-agent-instructions'",
    '        config:',
    '          maxBytes: 65536',
    '      - id: tool-pwsh',
    "        name: '@deepseek-ai/dsh-tool-pwsh'",
    "        disabled: !!js process.platform !== 'win32'",
    '      - id: tool-plugin-manager',
    "        name: '@deepseek-ai/dsh-plugin-manager/tools'",
    "        disabled: !!js \"!ctx.get('profileContext')\"",
    '',
    '',
  ].join('\n')
}

describe('locatePrefixLine / unquoteYamlScalar / yamlDoubleQuoted', () => {
  it('preset-standard 行 span 内唯一 prefix 行(缩进保留)', () => {
    const lines = fixturePatch(MARKER).split('\n')
    const found = locatePrefixLine(lines)
    expect(found.value).toBe(`'${MARKER}'`)
    expect(found.indent).toBe('          ')
    expect(lines[found.index]).toContain(MARKER)
  })

  it('无 preset-standard 行 → 抛(SDK 档不适用本写回路径)', () => {
    expect(() => locatePrefixLine(['- insert:', '  - id: other'])).toThrow(/preset-standard/)
  })

  it('span 内 0 或 2 个 prefix 行 → fail-closed 抛错', () => {
    const zero = fixturePatch(MARKER).replace(/          prefix: .*\n/u, '')
    expect(() => locatePrefixLine(zero.split('\n'))).toThrow(/期望 1,实际 0/u)
    const two = fixturePatch(MARKER).replace(
      '          maxBytes: 65536',
      '          maxBytes: 65536\n          prefix: \'extra\'',
    )
    expect(() => locatePrefixLine(two.split('\n'))).toThrow(/期望 1,实际 2/u)
  })

  it('单引号反引(’’→’)/ 双引号反引(转义)/ 块标量不支持', () => {
    expect(unquoteYamlScalar(`'it''s ${MARKER}'`)).toBe(`it's ${MARKER}`)
    expect(unquoteYamlScalar('"a\\nb \\"q\\" \\\\ c"')).toBe('a\nb "q" \\ c')
    expect(unquoteYamlScalar('"\\x41\\u00e9"')).toBe('Aé')
    expect(unquoteYamlScalar('plain text')).toBe('plain text')
    expect(unquoteYamlScalar('|')).toBeUndefined()
    expect(unquoteYamlScalar('>-')).toBeUndefined()
  })

  it('双引号转义:换行/引号/反斜杠/控制字符往返一致', () => {
    const nasty = 'line1\nline2 "quoted" \\ back\ttab\x01end'
    const quoted = yamlDoubleQuoted(nasty)
    expect(quoted.startsWith('"') && quoted.endsWith('"')).toBe(true)
    expect(unquoteYamlScalar(quoted)).toBe(nasty)
  })
})

describe('PersonaPatchFile(真实 fs 临时目录)', () => {
  let dir: string
  let patchPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-'))
    patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, fixturePatch(MARKER), 'utf8')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('read():available + persona 文本 + mtime ISO', async () => {
    const patch = new PersonaPatchFile(patchPath)
    const state = await patch.read()
    expect(state.available).toBe(true)
    expect(state.text).toBe(MARKER)
    expect(state.patchPath).toBe(patchPath)
    expect(state.error).toBeNull()
    expect(state.updatedAt).not.toBeNull()
    expect(Number.isNaN(Date.parse(state.updatedAt ?? ''))).toBe(false)
  })

  it('patch 文件不存在 → available=false + error(不抛)', async () => {
    const patch = new PersonaPatchFile(join(dir, 'missing.yml'))
    const state = await patch.read()
    expect(state.available).toBe(false)
    expect(state.error).toContain('不可读')
  })

  it('writeNext:纯文本变换——除 prefix 行外逐字节不变,!!js 行保真', async () => {
    const patch = new PersonaPatchFile(patchPath)
    const next = '你是一名的活动策划专家。\n红线:绝不绕过预算。'
    await patch.writeNext(next)
    const before = fixturePatch(MARKER).split('\n')
    const after = readFileSync(patchPath, 'utf8').split('\n')
    expect(after).toHaveLength(before.length)
    const changed: number[] = []
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== after[i]) changed.push(i)
    }
    expect(changed).toHaveLength(1)
    expect(after[changed[0] ?? -1]).toContain('prefix:')
    expect(after[changed[0] ?? -1]).toContain('活动策划专家')
    expect(after.some(line => line.includes('!!js process.platform'))).toBe(true)
    expect(after.some(line => line.includes("!!js \"!ctx.get('profileContext')\""))).toBe(true)
    const state = await patch.read()
    expect(state.text).toBe(next)
  })

  it('writeNext 无残留(.tmp/.bak),备份已清理', async () => {
    const patch = new PersonaPatchFile(patchPath)
    await patch.writeNext('v2')
    const leftovers = readdirSync(dir).filter(name => name.startsWith('.prompt-studio.'))
    expect(leftovers).toEqual([])
  })

  it('verify 失败 → 自动还原原始字节 + 上抛 + 无残留', async () => {
    const patch = new PersonaPatchFile(patchPath)
    const original = readFileSync(patchPath, 'utf8')
    await expect(patch.writeNext('bad persona', {
      verify: async () => { throw new Error('dump-config 干跑未通过') },
    })).rejects.toThrow('dump-config 干跑未通过')
    expect(readFileSync(patchPath, 'utf8')).toBe(original)
    expect(readdirSync(dir).filter(name => name.startsWith('.prompt-studio.'))).toEqual([])
  })

  it('写后文件可解析性自检口径:新 prefix 行是合法双引号 YAML 标量', async () => {
    const patch = new PersonaPatchFile(patchPath)
    const multi = '第一行\n"引号"行\n\\反斜杠'
    await patch.writeNext(multi)
    const line = readFileSync(patchPath, 'utf8').split('\n').find(candidate => candidate.includes('prefix:')) ?? ''
    const value = line.replace(/^\s*prefix: /u, '')
    expect(unquoteYamlScalar(value)).toBe(multi)
  })

  it('单写者串行:并发 writeNext 全部生效且互不覆盖(后写含先写后的基线)', async () => {
    const patch = new PersonaPatchFile(patchPath)
    await Promise.all([
      patch.writeNext('A'),
      patch.writeNext('B'),
      patch.writeNext('C'),
    ])
    const state = await patch.read()
    expect(['A', 'B', 'C']).toContain(state.text)
    // 三次写后仍无残留、文件结构完好
    expect(readdirSync(dir).filter(name => name.startsWith('.prompt-studio.'))).toEqual([])
    expect(locatePrefixLine(readFileSync(patchPath, 'utf8').split('\n')).value).not.toBeUndefined()
  })

  it('内容与现值一致 → 短路不写盘(verify 不被调用)', async () => {
    const patch = new PersonaPatchFile(patchPath)
    let verifyCalls = 0
    await patch.writeNext(MARKER, { verify: async () => { verifyCalls += 1 } })
    expect(verifyCalls).toBe(0)
    expect(readFileSync(patchPath, 'utf8')).toBe(fixturePatch(MARKER))
  })

  it('nodePersonaPatchIo.atomicWrite:目标内容原子达成且临时文件清理', async () => {
    const target = join(dir, 'atomic.txt')
    await nodePersonaPatchIo.atomicWrite(target, 'hello atomic')
    expect(readFileSync(target, 'utf8')).toBe('hello atomic')
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('buildNextPatchText 是纯函数(不改入参)', () => {
    const original = fixturePatch(MARKER)
    const next = buildNextPatchText(original, 'x')
    expect(original).toBe(fixturePatch(MARKER))
    expect(next.split('\n').length).toBe(original.split('\n').length)
  })
})

describe('selfCheckNextPatchText(保存前 YAML 解析自检,T7.3 ⑦)', () => {
  it('合法变换自检通过(往返一致 + 仅 prefix 行变更)', () => {
    const original = fixturePatch(MARKER)
    const next = buildNextPatchText(original, '新 persona\n第二行 "引号" \\ 转义')
    expect(() => { selfCheckNextPatchText(original, next, '新 persona\n第二行 "引号" \\ 转义') }).not.toThrow()
  })

  it('行数变化 → 抛(纯文本变换纪律被破坏)', () => {
    const original = fixturePatch(MARKER)
    const next = `${buildNextPatchText(original, 'x')}\n多余行`
    expect(() => { selfCheckNextPatchText(original, next, 'x') }).toThrow(/行数变了/)
  })

  it('新 prefix 行反引不一致 → 抛(YAML 转义有损)', () => {
    const original = fixturePatch(MARKER)
    const next = buildNextPatchText(original, '目标 persona')
    const broken = next.replace(
      /prefix: ".*"$/m,
      () => `prefix: ${yamlDoubleQuoted('被偷换的内容')}`,
    )
    expect(() => { selfCheckNextPatchText(original, broken, '目标 persona') }).toThrow(/反引结果与目标 persona 不一致/)
  })

  it('变更行数 ≠1 → 抛(其余字节必须原样)', () => {
    const original = fixturePatch(MARKER)
    const next = buildNextPatchText(original, 'y').replace('# T7.0 spike patch layer', '# 改了注释行')
    expect(() => { selfCheckNextPatchText(original, next, 'y') }).toThrow(/变更行数期望 1/)
  })

  it('writeNext 的落盘纪律:先备份后原子写(自检在两者之前,失败即零磁盘改动)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-order-'))
    const filePath = join(tmp, 'cordis.patch.yml')
    writeFileSync(filePath, fixturePatch(MARKER), 'utf8')
    const before = readFileSync(filePath, 'utf8')
    const calls: string[] = []
    const patchWithSpy = new PersonaPatchFile(filePath, {
      io: {
        ...nodePersonaPatchIo,
        atomicWrite: async (path, data) => {
          calls.push(`write:${path}`)
          return nodePersonaPatchIo.atomicWrite(path, data)
        },
        copyFile: async (from, to) => {
          calls.push(`backup:${to}`)
          return nodePersonaPatchIo.copyFile(from, to)
        },
      },
    })
    await patchWithSpy.writeNext('正常新内容')
    // 备份先于写盘(还原依赖备份);写盘前一切拦截(自检/短路)都意味着零调用。
    expect(calls[0]).toMatch(/^backup:.*\.prompt-studio\..*\.bak$/u)
    expect(calls[1]).toBe(`write:${filePath}`) // atomicWrite 收到目标路径;tmp 文件在其内部产生并清理
    expect(readFileSync(filePath, 'utf8')).not.toBe(before)
    expect((await new PersonaPatchFile(filePath).read()).text).toBe('正常新内容')
    rmSync(tmp, { recursive: true, force: true })
  })
})
