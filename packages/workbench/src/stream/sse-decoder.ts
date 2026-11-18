/**
 * SSE(text/event-stream)客户端解码器(38 号 T4/G2-D5;30 号 §3 客户端行
 * 「解码器照搬 chat-demo 的 WHATWG 规范实现」)。
 *
 * 本文件为 chat-demo src/services/api/sse.ts 的行为等价移植(源文件不在本仓,
 * 38 号 B8;以 24 号 §3.2 三陷阱表为验收口径):
 * 1. 一个事件被切成半个 —— buffer 累积,只在空行派发;
 * 2. `\r` 是 CRLF 的半个 —— 结尾 CR 不下发,等下一片;
 * 3. 多字节中文被切断 —— TextDecoder.decode(value, { stream: true })。
 *
 * 规范:https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 * 字节流 → UTF-8 解码 → 按 CRLF / LF / CR 切行 → 字段累积 → 空行派发事件。
 * 注释行(如服务端保活的 `: keep-alive`)直接忽略;`retry` 只对 EventSource
 * 重连有意义,这里不处理。
 */

export type ServerSentEvent = {
  /** `event` 字段,缺省为 `message`。 */
  event: string
  /** 多行 `data` 以 `\n` 连接。 */
  data: string
  /** 最近一次 `id` 字段。 */
  lastEventId: string
}

const LINE_BREAK = /\r\n|\r|\n/g

export class ServerSentEventDecoder {
  private buffer = ''
  private data = ''
  private hasData = false
  private eventType = ''
  private lastEventId = ''

  /** 输入一段已解码的文本,返回其中完整的事件。 */
  push(text: string): ServerSentEvent[] {
    this.buffer += text
    const events: ServerSentEvent[] = []
    let lineStart = 0
    LINE_BREAK.lastIndex = 0
    for (let match = LINE_BREAK.exec(this.buffer); match; match = LINE_BREAK.exec(this.buffer)) {
      // 结尾的 CR 可能是 CRLF 的前半,等下一段再判断(三陷阱之二)
      if (match[0] === '\r' && LINE_BREAK.lastIndex === this.buffer.length) {
        break
      }
      const event = this.processLine(this.buffer.slice(lineStart, match.index))
      if (event) {
        events.push(event)
      }
      lineStart = LINE_BREAK.lastIndex
    }
    this.buffer = this.buffer.slice(lineStart)
    return events
  }

  /** 流结束:结尾的 CR 是完整的换行,其余未以空行结尾的事件按规范丢弃。 */
  end(): ServerSentEvent[] {
    const event = this.buffer.endsWith('\r') ? this.processLine(this.buffer.slice(0, -1)) : null
    this.buffer = ''
    this.data = ''
    this.hasData = false
    this.eventType = ''
    return event ? [event] : []
  }

  private processLine(line: string): ServerSentEvent | null {
    if (line === '') {
      return this.dispatch()
    }
    if (line.startsWith(':')) {
      return null
    }
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }
    switch (field) {
      case 'data':
        this.data = this.hasData ? `${this.data}\n${value}` : value
        this.hasData = true
        break
      case 'event':
        this.eventType = value
        break
      case 'id':
        if (!value.includes('\0')) {
          this.lastEventId = value
        }
        break
      default:
        break
    }
    return null
  }

  private dispatch(): ServerSentEvent | null {
    const event: ServerSentEvent | null = this.hasData
      ? { event: this.eventType || 'message', data: this.data, lastEventId: this.lastEventId }
      : null
    this.data = ''
    this.hasData = false
    this.eventType = ''
    return event
  }
}

/**
 * 逐个产出字节流中的 SSE 事件;流读完即结束(三陷阱之三:stream:true 保证
 * 多字节字符跨分片时不被截断)。中止或调用方提前退出时取消读取以释放连接,
 * 不依赖底层网络把中止传到响应体。
 */
export async function* readServerSentEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader()
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  // TextDecoder 默认会去掉开头的 BOM;stream: true 保证多字节字符跨分片时不被截断
  const textDecoder = new TextDecoder()
  const decoder = new ServerSentEventDecoder()
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        finished = true
        for (const event of decoder.end()) {
          yield event
        }
        break
      }
      for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
        yield event
      }
    }
  } finally {
    if (!finished) {
      void reader.cancel(signal?.reason).catch(() => {})
    }
    signal?.removeEventListener('abort', onAbort)
  }
}
