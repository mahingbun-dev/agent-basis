/** 最小 WebSocket 客户端（仅测试用）：raw upgrade + 文本帧收发。
 *  Node 自带 WebSocket 不支持自定义 header（cookie），故用 net 手写握手/帧。
 */
import { connect } from 'node:net'
import { randomBytes } from 'node:crypto'

export function openMuxSocket({ host = '127.0.0.1', port = 3118, path = '/api/remote.mux', cookie }) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host, port })
    let handshake = ''
    let upgraded = false
    const messages = []
    const waiters = []
    let closed = false

    const key = randomBytes(16).toString('base64')
    socket.on('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        `Cookie: ${cookie}`,
        '',
        '',
      ].join('\r\n'))
    })
    socket.on('error', error => reject(error))

    let buffer = Buffer.alloc(0)
    socket.on('data', chunk => {
      if (!upgraded) {
        handshake += chunk.toString('binary')
        const index = handshake.indexOf('\r\n\r\n')
        if (index === -1) return
        const header = handshake.slice(0, index)
        const rest = Buffer.from(handshake.slice(index + 4), 'binary')
        if (!/^HTTP\/1\.1 101/.test(header)) {
          reject(new Error(`upgrade 未成功: ${header.split('\r\n')[0]}`))
          socket.destroy()
          return
        }
        upgraded = true
        buffer = Buffer.concat([buffer, rest])
        resolvePromise({
          send: payload => socket.write(encodeFrame(typeof payload === 'string' ? payload : JSON.stringify(payload))),
          messages,
          close: () => socket.destroy(),
          waitMessage: (predicate, timeoutMs = 8000) => waitMessage(messages, waiters, predicate, timeoutMs),
        })
        processBuffer()
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      processBuffer()
    })
    socket.on('close', () => { closed = true; for (const waiter of waiters) waiter.reject(new Error('socket closed')) })

    function processBuffer() {
      while (buffer.length >= 2) {
        const first = buffer[0]
        const second = buffer[1]
        const opcode = first & 0x0f
        let length = second & 0x7f
        let offset = 2
        if (length === 126) {
          if (buffer.length < 4) return
          length = buffer.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          if (buffer.length < 10) return
          length = Number(buffer.readBigUInt64BE(2))
          offset = 10
        }
        const masked = (second & 0x80) !== 0
        const maskLength = masked ? 4 : 0
        if (buffer.length < offset + maskLength + length) return
        let payload = buffer.subarray(offset + maskLength, offset + maskLength + length)
        if (masked) {
          const mask = buffer.subarray(offset, offset + 4)
          payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))
        }
        buffer = buffer.subarray(offset + maskLength + length)
        if (opcode === 8) { closed = true; socket.destroy(); return }
        if (opcode === 9) { socket.write(encodeFrame('', 10)); continue }
        if (opcode !== 1 && opcode !== 0) continue
        const text = payload.toString('utf8')
        let json
        try { json = JSON.parse(text) } catch { json = { raw: text } }
        messages.push(json)
        for (const waiter of [...waiters]) {
          if (waiter.predicate(json)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(json); waiter.timer.unref?.() }
        }
      }
    }

    function waitMessage(msgs, waits, predicate, timeoutMs) {
      const found = msgs.find(predicate)
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => { waits.splice(waits.indexOf(waiter), 1); rejectWait(new Error(`等消息超时(${timeoutMs}ms)`)) }, timeoutMs)
        const waiter = { predicate, resolve: value => { clearTimeout(timer); resolveWait(value) }, reject: error => { clearTimeout(timer); rejectWait(error) }, timer }
        waits.push(waiter)
      })
    }
  })
}

function encodeFrame(text, opcode = 1) {
  const payload = Buffer.from(text, 'utf8')
  const mask = randomBytes(4)
  let header
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))
  return Buffer.concat([header, mask, masked])
}