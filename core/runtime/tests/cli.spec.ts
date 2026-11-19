/**
 * CLI 编排冒烟:run 命令退出码约定(0/1/2)、输出面、--json、chat EOF 退出。
 * io 全注入;bundle 用 stub-agent fixture(不依赖插件面包)。
 */
import { describe, expect, it } from 'vitest'
import { runBasis } from '../src/cli.ts'
import type { CliIo } from '../src/cli.ts'

function stubIo(lines: readonly (string | null)[]): { io: CliIo; out: string[] } {
  const out: string[] = []
  let cursor = 0
  return {
    out,
    io: {
      writeLine: (line) => { out.push(line) },
      readLine: async () => {
        const line = cursor < lines.length ? lines[cursor++]! : null
        return line
      },
      env: name => process.env[name],
    },
  }
}

const BUNDLE = 'tests/fixtures/basis-run.yml'

describe('basis CLI 编排', () => {
  it('--help 打印用法,退出 0', async () => {
    const { io, out } = stubIo([])
    const code = await runBasis(['--help'], io)
    expect(code).toBe(0)
    expect(out[0]).toContain('basis ——')
  })

  it('run:单 turn 输出,退出 0', async () => {
    const { io, out } = stubIo([])
    const code = await runBasis(['run', '你好', '--bundle', BUNDLE], io)
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('echo(default):你好')
  })

  it('run --json:输出 TurnResult JSON', async () => {
    const { io, out } = stubIo([])
    const code = await runBasis(['run', 'hi', '--bundle', BUNDLE, '--json'], io)
    expect(code).toBe(0)
    const parsed = JSON.parse(out[0]!) as { output: string }
    expect(parsed.output).toContain('echo(default):hi')
  })

  it('run 缺 prompt:退出 2', async () => {
    const { io, out } = stubIo([])
    const code = await runBasis(['run', '--bundle', BUNDLE], io)
    expect(code).toBe(2)
    expect(out[0]).toContain('prompt')
  })

  it('run bundle 装载失败:退出 1', async () => {
    const { io, out } = stubIo([])
    const code = await runBasis(['run', 'hi', '--bundle', 'tests/fixtures/nope.yml'], io)
    expect(code).toBe(1)
    expect(out[0]).toContain('装载失败')
  })

  it('chat:逐行 turn,EOF 退出', async () => {
    const { io, out } = stubIo(['第一句', '第二句', null])
    const code = await runBasis(['chat', '--bundle', BUNDLE], io)
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('echo(default):第一句')
    expect(out.join('\n')).toContain('echo(default):第二句')
  })

  it('chat:/exit 提前退出', async () => {
    const { io, out } = stubIo(['/exit'])
    const code = await runBasis(['chat', '--bundle', BUNDLE], io)
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('已就绪')
  })
})
