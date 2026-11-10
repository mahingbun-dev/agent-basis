// CLI：start / status / call 三个子命令（开发与冒烟用）。
//   node src/cli.ts start [--port 9310] [--token T]
//   node src/cli.ts status [--port 9310]
//   node src/cli.ts call <tool> [--args '{"...":...}'] [--port 9310]

import { RelayServer } from './server.ts'

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv
  const port = Number(argValue(rest, '--port') ?? '9310')
  const base = `http://127.0.0.1:${String(port)}`
  switch (cmd) {
    case 'start': {
      const token = argValue(rest, '--token')
      const server = new RelayServer({ port, ...(token !== undefined ? { token } : {}) })
      await server.start()
      // 进程驻留
      await new Promise<void>(() => {})
      return
    }
    case 'status': {
      const res = await fetch(`${base}/api/status`)
      console.log(JSON.stringify(await res.json(), null, 2))
      return
    }
    case 'call': {
      const tool = rest[0]
      if (tool === undefined) throw new Error("用法：call <tool> [--args '{...}']")
      const argsRaw = argValue(rest, '--args') ?? '{}'
      const res = await fetch(`${base}/api/tools`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: tool, args: JSON.parse(argsRaw) as unknown }),
      })
      console.log(JSON.stringify(await res.json(), null, 2))
      return
    }
    default:
      console.log('用法：eterna-browser-relay start|status|call ...')
      process.exitCode = 2
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
