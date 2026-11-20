import { sessions } from './env.mjs'
import { connect } from 'node:net'
import { randomBytes } from 'node:crypto'

const s = await sessions()
const cookie = s.admin.cookie
const sock = connect({ host: '127.0.0.1', port: 3118 })
sock.on('connect', () => {
  const key = randomBytes(16).toString('base64')
  sock.write([
    'GET /api/remote.mux HTTP/1.1',
    'Host: 127.0.0.1:3118',
    'Origin: http://127.0.0.1:3118',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    `Cookie: ${cookie}`,
    '',
    '',
  ].join('\r\n'))
})
sock.on('data', data => { console.log('DATA', JSON.stringify(data.toString('binary').slice(0, 400))) })
sock.on('close', () => { console.log('CLOSED'); process.exit(0) })
sock.on('error', error => { console.log('ERR', error.message); process.exit(0) })
setTimeout(() => { console.log('TIMEOUT'); sock.destroy(); process.exit(0) }, 5000)