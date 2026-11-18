/**
 * SSE(text/event-stream)解码——36 号 K2.1,翻译 chat-demo `src/services/api/sse.ts`
 * 的 ServerSentEventDecoder(按 WHATWG 规范实现):
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 *
 * 字节流 → UTF-8 解码 → 按 CRLF / LF / CR 切行 → 字段累积 → 空行派发事件。
 * 注释行(如服务端保活的 `: keep-alive`)直接忽略;`retry` 只对 EventSource 重连
 * 有意义,这里不处理。
 *
 * 与 chat-demo 的差异:解码器只吃**已解码文本**(push/end 字符串接口)——网络流读取
 * 属传输层职责(toolkit 是能力层,llm-openai 是薄传输层,36 号 §1.1/Q5 分层),
 * 测试侧以 SSE 文本回放(fixture 回放为门禁主体,36 号 §1.9)。
 */

export interface ServerSentEvent {
  /** `event` 字段,缺省为 `message`。 */
  readonly event: string
  /** 多行 `data` 以 `\n` 连接。 */
  readonly data: string
  /** 最近一次 `id` 字段。 */
  readonly lastEventId: string
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
      // 结尾的 CR 可能是 CRLF 的前半,等下一段再判断。
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
 * 解码一段**完整**的 SSE 文本(一次性输入 + end):fixture 回放与短响应消费口。
 * 分段输入场景直接使用 ServerSentEventDecoder。
 */
export function decodeSseText(text: string): ServerSentEvent[] {
  const decoder = new ServerSentEventDecoder()
  return [...decoder.push(text), ...decoder.end()]
}
