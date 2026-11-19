/**
 * session 插件:provide ctx.session + 订阅审批事件落盘(approval/asked、approval/decided)
 * + session/event 采集点接线。config: { file?: string }。
 */
import type { Context } from '@core/cordis'
import { SessionStoreImpl } from './store.ts'

export const SESSION_PLUGIN_NAME = 'basis-session'

export interface SessionPluginConfig {
  /** JSONL 落盘文件;缺省仅内存。 */
  readonly file?: string
}

export function defineSessionPlugin(config: SessionPluginConfig = {}) {
  return {
    name: SESSION_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const store = new SessionStoreImpl({
        ...(config.file !== undefined ? { file: config.file } : {}),
        onEvent: (event) => { ctx.events.emit('session/event', event) },
      })
      const disposers = [
        ctx.provide('session', store),
        // 审批留痕:approval 插件只发事件,落盘职责统一在 session(单一写入口)
        ctx.on('approval/asked', (request) => {
          store.append('approval/asked', { id: request.id, toolName: request.tool, ...(request.callId !== undefined ? { callId: request.callId } : {}), ...(request.reasons.length > 0 ? { reason: request.reasons.join('; ') } : {}) })
        }),
        ctx.on('approval/decided', (request, outcome) => {
          store.append('approval/decided', { id: request.id, outcome })
        }),
      ]
      return () => {
        for (const dispose of disposers.reverse()) dispose()
      }
    },
  }
}

export default defineSessionPlugin()
