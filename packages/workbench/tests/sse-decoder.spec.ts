/**
 * SSE 解码器三陷阱测试(38 号 T4/G2-D5;24 号 §3.2 三陷阱表逐字对齐;
 * chat-demo sse.ts 行为等价移植的验收)。
 * 注:CR/LF 一律经 String.fromCharCode 构造,避免源码里出现裸控制字符。
 */
import { describe, expect, it } from 'vitest'
import { ServerSentEventDecoder, readServerSentEvents } from '../src/stream/sse-decoder.ts'

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)

/** 把字符串按 UTF-8 字节切成若干分片,模拟网络 chunking。 */
function byteChunks(text: string, sizes: number[]): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const chunks: Uint8Array[] = []
  let cursor = 0
  for (const size of sizes) {
    if (cursor >= bytes.length) break
    chunks.push(bytes.slice(cursor, cursor + size))
    cursor += size
  }
  if (cursor < bytes.length) chunks.push(bytes.slice(cursor))
  return chunks
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!)
        index += 1
      } else {
        controller.close()
      }
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<{ event: string; data: string; lastEventId: string }[]> {
  const events: { event: string; data: string; lastEventId: string }[] = []
  for await (const sse of readServerSentEvents(stream)) events.push(sse)
  return events
}

describe('陷阱一:一个事件被切成半个(buffer 累积,只在空行派发)', () => {
  it('data 分三片到达,只在完整空行后派发一个事件', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('id: 7' + LF + 'event: work')).toEqual([])
    expect(decoder.push('bench-mock' + LF + 'data: {"kind":"snap')).toEqual([])
    expect(decoder.push('shot"}' + LF)).toEqual([])
    expect(decoder.push(LF)).toEqual([
      { event: 'workbench-mock', data: '{"kind":"snapshot"}', lastEventId: '7' },
    ])
  })

  it('多行 data 以 LF 连接;注释行忽略;event 缺省 message', () => {
    const decoder = new ServerSentEventDecoder()
    const events = decoder.push(': keep-alive' + LF + LF + 'data: 第一行' + LF + 'data: 第二行' + LF + LF)
    expect(events).toEqual([{ event: 'message', data: '第一行' + LF + '第二行', lastEventId: '' }])
  })

  it('字段值仅剥一个前导空格(尾随空格保留,WHATWG)', () => {
    const decoder = new ServerSentEventDecoder()
    const events = decoder.push('id: 1 ' + LF + 'data:  x' + LF + LF)
    expect(events).toEqual([{ event: 'message', data: ' x', lastEventId: '1 ' }])
  })

  it('id 含 NUL 拒绝(WHATWG 规范)', () => {
    const decoder = new ServerSentEventDecoder()
    const events = decoder.push('id: 1' + LF + 'data: a' + LF + LF + 'id: bad' + String.fromCharCode(0) + LF + 'data: b' + LF + LF)
    expect(events).toEqual([
      { event: 'message', data: 'a', lastEventId: '1' },
      { event: 'message', data: 'b', lastEventId: '1' },
    ])
  })
})

describe('陷阱二:CR 是 CRLF 的半个(结尾 CR 不下发,等下一片)', () => {
  it('chunk 以孤立 CR 结尾:暂不切行,等下一片确认 CRLF', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: a' + CR)).toEqual([])
    expect(decoder.push(LF + LF + 'data: b' + LF + LF)).toEqual([
      { event: 'message', data: 'a', lastEventId: '' },
      { event: 'message', data: 'b', lastEventId: '' },
    ])
  })

  it('CR 单独成行也是合法换行(WHATWG):CR CR = 行尾 + 空行派发', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: a' + CR + CR + 'data: b' + LF + LF)).toEqual([
      { event: 'message', data: 'a', lastEventId: '' },
      { event: 'message', data: 'b', lastEventId: '' },
    ])
  })

  it('流结束时结尾 CR 按完整换行收尾;未以空行结尾的事件按规范丢弃', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: end' + CR + CR)).toEqual([])
    expect(decoder.end()).toEqual([{ event: 'message', data: 'end', lastEventId: '' }])
    const late = new ServerSentEventDecoder()
    late.push('data: never-dispatched' + LF)
    expect(late.end()).toEqual([])
  })
})

describe('陷阱三:多字节中文被切断(TextDecoder stream:true)', () => {
  it('「合批 200ms」跨字节分片到达,事件完整不乱码', async () => {
    const payload = 'event: workbench-mock' + LF + 'data: {"note":"合批 200ms 避免打爆渲染"}' + LF + LF
    // 「批」等 3 字节字符被切在 chunk 边界
    const chunks = byteChunks(payload, [28, 3, 1, 19, 7])
    const events = await collect(streamOf(chunks))
    expect(events).toEqual([
      { event: 'workbench-mock', data: '{"note":"合批 200ms 避免打爆渲染"}', lastEventId: '' },
    ])
  })

  it('字节流逐字节推进(极限碎切)仍完整解码', async () => {
    const payload = 'id: 3' + LF + 'data: 跨分片' + LF + LF
    const encoder = new TextEncoder()
    const chunks = [...encoder.encode(payload)].map(byte => new Uint8Array([byte]))
    const events = await collect(streamOf(chunks))
    expect(events).toEqual([{ event: 'message', data: '跨分片', lastEventId: '3' }])
  })
})

describe('readServerSentEvents 流语义(chat-demo 行为等价)', () => {
  it('AbortSignal 取消读取即结束迭代(不依赖网络层传播)', async () => {
    const controller = new AbortController()
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode('data: loop' + LF + LF))
      },
    })
    const seen: string[] = []
    for await (const sse of readServerSentEvents(stream, controller.signal)) {
      seen.push(sse.data)
      if (seen.length === 2) controller.abort()
    }
    expect(seen).toEqual(['loop', 'loop'])
  })
})
