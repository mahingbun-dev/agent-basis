/**
 * basis CLI 纯编排:runBasis(argv, io) → 退出码(0/1/2,对齐 packctl 约定)。
 * 命令:
 *   basis chat  [--bundle <file>] [--agent <name>]   REPL(逐行输入 = 一个 turn)
 *   basis run "<prompt>" [--bundle <file>] [--json]  单 turn 非交互
 * io 注入(stdout/stdin/exit)使 REPL 逻辑可测;默认实现接 process。
 */
import { createInterface } from 'node:readline/promises'
import { dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { SessionEvent } from '@core/contracts'
import { bootBundle, parseManifestYaml } from './boot.ts'
import type { BootedBundle } from './boot.ts'

const USAGE = [
  'basis —— 自持内核运行时 CLI(一切皆插件)',
  '用法:',
  '  basis chat  [--bundle <file>] [--agent <name>]   会话 REPL(/exit 退出)',
  '  basis run "<prompt>" [--bundle <file>] [--json]  单 turn 非交互',
  '  --bundle 缺省为 ./basis.yml;--agent 覆盖 manifest 的默认 agent。',
  '环境:LITELLM_API_KEY(llm 路由凭据;也可经 --env-file 指定的 dotenv 文件注入)。',
].join('\n')

/** CLI 输出面(io 注入,可测)。 */
export interface CliIo {
  /** 写一行到标准输出。 */
  writeLine(line: string): void
  /** REPL 读一行(由 stdin 驱动;EOF 时 resolve null)。 */
  readLine(prompt: string): Promise<string | null>
  /** 读取 env(便于测试注入凭据)。 */
  env(name: string): string | undefined
}

export function processIo(): CliIo {
  return {
    writeLine: (line) => { console.log(line) },
    readLine: async (prompt) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
      const answer = await rl.question(prompt)
      rl.close()
      return answer
    },
    env: name => process.env[name],
  }
}

interface ParsedArgs {
  readonly command: string
  readonly positional: readonly string[]
  readonly flags: Readonly<Record<string, string | boolean>>
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        index++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { command: positional[0] ?? '', positional: positional.slice(1), flags }
}

/** 装载 bundle(--bundle 缺省 ./basis.yml;--env-file 先注入 env)。 */
async function loadBundle(flags: Readonly<Record<string, string | boolean>>, io: CliIo): Promise<BootedBundle> {
  const envFile = typeof flags['env-file'] === 'string' ? flags['env-file'] : undefined
  if (envFile !== undefined) {
    const text = await readFile(envFile, 'utf8')
    for (const line of text.split('\n')) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
      const key = match?.[1]
      const value = match?.[2]
      if (key !== undefined && value !== undefined && io.env(key) === undefined) {
        process.env[key] = value.replace(/^["']|["']$/g, '')
      }
    }
  }
  const bundlePath = typeof flags['bundle'] === 'string' ? flags['bundle'] : 'basis.yml'
  const text = await readFile(bundlePath, 'utf8')
  const manifest = parseManifestYaml(text)
  return bootBundle(manifest, dirname(bundlePath))
}

/** agent 名解析优先级:--agent > manifest.agent > 注册侧默认。 */
function agentNameOf(flags: Readonly<Record<string, string | boolean>>, bundle: BootedBundle): string | undefined {
  return typeof flags['agent'] === 'string' ? flags['agent'] : bundle.manifest.agent
}

/** CLI 主入口:返回进程退出码(不直接 process.exit,便于测试)。 */
export async function runBasis(argv: readonly string[], io: CliIo): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === undefined) {
    io.writeLine(USAGE)
    return 0
  }
  const parsed = parseArgs(argv)

  if (parsed.command === 'run') {
    const prompt = parsed.positional[0]
    if (prompt === undefined || prompt.length === 0) {
      io.writeLine('basis run:需要 prompt 参数')
      return 2
    }
    let bundle: BootedBundle
    try {
      bundle = await loadBundle(parsed.flags, io)
    } catch (error) {
      io.writeLine(`basis run:bundle 装载失败:${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    try {
      const runner = bundle.ctx.agents.resolve(agentNameOf(parsed.flags, bundle), bundle.ctx)
      const result = await runner.run(prompt)
      if (parsed.flags['json'] === true) {
        io.writeLine(JSON.stringify(result))
      } else {
        io.writeLine(result.output)
      }
      return 0
    } catch (error) {
      io.writeLine(`basis run:turn 失败:${error instanceof Error ? error.message : String(error)}`)
      return 1
    } finally {
      await bundle.dispose()
    }
  }

  if (parsed.command === 'chat') {
    let bundle: BootedBundle
    try {
      bundle = await loadBundle(parsed.flags, io)
    } catch (error) {
      io.writeLine(`basis chat:bundle 装载失败:${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    try {
      const runner = bundle.ctx.agents.resolve(agentNameOf(parsed.flags, bundle), bundle.ctx)
      io.writeLine('basis chat 已就绪(/exit 或 EOF 退出;每行输入 = 一个 turn)')
      // 会话事件回显:工具调用/结果与审批结论实时可见
      bundle.ctx.events.on('session/event', (event) => {
        const record = event as SessionEvent
        if (record.type === 'tool/call') {
          const data = record.data as { readonly name: string }
          io.writeLine(`  · tool: ${data.name}`)
        } else if (record.type === 'approval/decided') {
          const data = record.data as { readonly id: string; readonly outcome: string }
          io.writeLine(`  · 审批 ${data.outcome}(${data.id})`)
        }
      })
      for (;;) {
        const line = await io.readLine('> ')
        if (line === null || line.trim() === '/exit' || line.trim() === '/quit') return 0
        if (line.trim().length === 0) continue
        try {
          const result = await runner.run(line)
          io.writeLine(result.output)
        } catch (error) {
          io.writeLine(`turn 失败:${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      await bundle.dispose()
    }
  }

  io.writeLine(`未知命令:${parsed.command}\n${USAGE}`)
  return 2
}

/** 进程入口(bin/basis.mjs 用)。 */
export async function runCliMain(argv: readonly string[]): Promise<number> {
  return runBasis(argv, processIo())
}
