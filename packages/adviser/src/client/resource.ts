/**
 * 参谋会话的资源提供者:地址 → `SessionReference`(P5)。
 *
 * 与上游 `ui-subagent/src/client/sidebar-chat/index.tsx` 的 chat 资源同构:
 * - `open()` 先 `retain` 一个会话引用,`yield` 第一帧把引用交给 UI;
 * - 然后**挂住**直到 signal 被 abort(最后一个订阅者/引用释放),finally 释放。
 *
 * 为什么挂住而不是立即返回:资源模型的语义是「流在持有者归零时被 abort」
 * (`client-resources` 的 hold/release),一条只 yield 一次就结束的流会让资源在
 * 下一帧被 stop → 引用被释放 → 会话作用域被拆 → 面板空白。
 *
 * 失败面:未识别的地址或 retain 失败都要以**失败帧**上报(不是 throw)——
 * 流内 throw 按上游契约属于编程错误,资源会永远停在 loading。
 */
import type {
  ResourceFrameFace, ResourceOpenContextFace, ResourceProviderFace, SessionReferenceFace, SessionsFace,
} from './client-types.ts'
import { ADVISER_PROTOCOL, parseAdviserChatAddress } from './address.ts'

/** 资源值:一条已持有的参谋会话引用(UI 用它做 SessionProvider.session)。 */
export interface AdviserChatResource {
  readonly reference: SessionReferenceFace
  readonly parentSessionId: string
  readonly childSessionId: string
}

/** 本插件在 retainedBy 计数里的来源标签。 */
export const ADVISER_REFERENCE_SOURCE = 'adviserPanel'

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/**
 * 造一个参谋会话的资源提供者。
 * @param sessions - 会话服务(retain 的持有者)。
 * @returns 注册到 `ctx.resources.register` 的提供者。
 */
export function createAdviserChatProvider(sessions: SessionsFace): ResourceProviderFace<AdviserChatResource> {
  return {
    protocol: ADVISER_PROTOCOL,
    async *open(address: string, ctx: ResourceOpenContextFace): AsyncIterable<ResourceFrameFace<AdviserChatResource>> {
      const target = parseAdviserChatAddress(address)
      if (target === undefined) {
        yield { ok: false, error: new Error(`eterna-adviser: 无法识别的参谋地址 "${address}"`) }
        return
      }
      if (ctx.signal.aborted) return
      let reference: SessionReferenceFace
      try {
        // 先刷父会话投影:subagent 子会话的可解析性来自父会话 catalog(见
        // SessionsFace.refreshProjections 的注)。失败不致命——会话可能已在列表里。
        await sessions.refreshProjections(target.parentSessionId).catch(() => undefined)
        reference = sessions.retain(target.childSessionId, {
          source: ADVISER_REFERENCE_SOURCE,
          signal: ctx.signal,
        })
      } catch (error) {
        yield { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
        return
      }
      try {
        yield { ok: true, value: { reference, ...target } }
        await waitForAbort(ctx.signal)
      } finally {
        reference.release()
      }
    },
  }
}
