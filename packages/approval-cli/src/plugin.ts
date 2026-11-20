/**
 * approval 插件:provide ctx.approval(CLI 交互面);留痕经事件发出,
 * 由 session 插件订阅落盘(单一写入口纪律)。
 */
import { createInterface } from 'node:readline/promises'
import type { Context } from '@core/cordis'
import { ApprovalCli } from './cli-approval.ts'
import type { ApprovalIo } from './cli-approval.ts'

export const APPROVAL_PLUGIN_NAME = 'basis-approval-cli'

export function defineApprovalPlugin() {
  return {
    name: APPROVAL_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const io: ApprovalIo = {
        writeLine: (line) => { console.log(line) },
        readLine: async (prompt) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
          const answer = await rl.question(prompt)
          rl.close()
          return answer
        },
      }
      const cli = new ApprovalCli({
        io,
        onAsked: (request) => { ctx.events.emit('approval/asked', request) },
        onDecided: (request, outcome) => { ctx.events.emit('approval/decided', request, outcome) },
      })
      return ctx.provide('approval', cli)
    },
  }
}

export default defineApprovalPlugin()
