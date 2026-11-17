/**
 * 登录门禁的索引页跳转(2026-11-17):未登录/浏览器 cookie 过期时,访问域名根
 * 自动跳 /login,而不是裸 401 文本页。
 *
 * 背景(实测,非推测):
 * - dsh host-frontend-static 只把 index 请求交给 connection.authorizeIndex
 *   (dsh-host-frontend-static lib/index.js:115-129 的 Response 汇 shim);
 * - authorizeIndex 对「无 launch token 且无浏览器 cookie」一律 401 text/plain
 *   (dsh-client-connection lib/index.js:458-497)——index HTML 根本不发,所以
 *   tapIndex 注入的 BADGE_SCRIPT(pages.ts)门禁脚本没有机会运行;
 * - 原设计把「匿名 / → 302 /login」留给反代 nginx error_page 401 配方(登录插件
 *   计划 §4 T1.10),但配方未落库,直连端口/其他反代形态全部退化为裸 401。
 *
 * 修法:包装 connection.authorizeIndex(沿 mux.ts/sandbox.ts 的运行时包装先例,
 * 不碰上游源码)。只有 401 拒绝被改写成 302 /login:
 * - 有效 launch token 兑换的 303(`?token=` → set-cookie → `./`)原样放行;
 * - 已认证(true)原样放行;
 * - 302 到 /login 后:账本会话有效 → GET /login 的 bridgeHome 重新附当前进程
 *   launch token 桥回(浏览器 cookie 过期的自愈路径);会话无效 → 渲染登录页。
 * 不改变任何鉴权决策:该拒的仍然拒,只是把拒绝的「表现层」从文本页换成登录页。
 */

/** authorizeIndex 的响应汇(上游 frontend-static 的 Response 采集 shim 同构子集)。 */
export interface IndexAuthSink {
  writeHead(status: number, headers?: unknown): void
  end(body?: string): void
}

/** 本模块消费的 connection 结构子集(dsh-client-connection Connection.authorizeIndex)。 */
export interface IndexAuthorizer {
  authorizeIndex?: (request: unknown, sink: IndexAuthSink) => boolean
}

/** 未认证索引请求的跳转目标。 */
export const LOGIN_GATE_LOCATION = '/login'

/**
 * 安装跳转门禁;返回还原闭包。上游未提供 authorizeIndex(版本漂移/服务缺席)时
 * 返回 undefined 且不做任何改动——保持既有行为(裸 401),不上抛、不阻断 apply。
 */
export function installLoginGate(connection: IndexAuthorizer | undefined): (() => void) | undefined {
  if (connection === undefined || typeof connection.authorizeIndex !== 'function') return undefined
  const original = connection.authorizeIndex
  const wrapped = function (this: unknown, request: unknown, sink: IndexAuthSink): boolean {
    let status = 0
    // 先原样转发写入(上游 shim 后写覆盖先写);仅在终态 401 时补一次 302。
    const recording: IndexAuthSink = {
      writeHead(nextStatus, headers) {
        status = nextStatus
        sink.writeHead(nextStatus, headers)
      },
      end(body) {
        sink.end(body)
      },
    }
    const authorized = original.call(this, request, recording)
    if (authorized || status !== 401) return authorized
    sink.writeHead(302, { location: LOGIN_GATE_LOCATION, 'cache-control': 'no-store' })
    sink.end()
    return false
  }
  try {
    connection.authorizeIndex = wrapped
  } catch {
    // 上游对象不可写(冻结/原型受限):放弃包装,保留 401 原行为
    return undefined
  }
  return () => {
    if (connection.authorizeIndex === wrapped) connection.authorizeIndex = original
  }
}
