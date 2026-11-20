#!/usr/bin/env node
/**
 * chat-import 夹具生成器（51 §1；54 §6.2；T47）。
 *
 * rc.5 上游 `@deepseek-ai/dsh-deepseek-chat-import` 的归档格式**不是**裸 NDJSON，
 * 而是一个 zip（DeepSeek chat export v3）：
 *   manifest.json              {"export_format_version":3}
 *   chat_session_index.json    [{id, inserted_at, updated_at}, ...]
 *   chat_sessions/{id}.json    {id,title,current_message_id,messages:[...]}
 * 进度与终态响应才是 `application/x-ndjson`（每行一个 JSON）。
 *
 * 本生成器产出两份夹具：
 *   1. deepseek-export-11.zip —— 真实上传格式：11 个会话（10 个可用 +
 *      1 个坏 JSON），其中 conv-10 为超大（约 8MB 未压缩）。导入器会跳过坏会话、
 *      继续导入其余 10 个，终态 outcome.value.sessionIds 长度 = 10（IMP-003/009）。
 *   2. sessions-10.ndjson —— 51 §1 字面要求（10 会话 NDJSON + 1 行坏 JSON），
 *      仅作解析健壮性/负向夹具：直接上传它会被上游判为 unreadable-archive。
 *
 * 用法：
 *   node tests/fixtures/chat-import/generate.mjs
 *   node tests/fixtures/chat-import/generate.mjs --out /tmp/chat-import
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const outIndex = process.argv.indexOf('--out')
const OUT = outIndex === -1 ? here : resolve(process.argv[outIndex + 1])

/* --------------------------------------------------------------- zip 写入 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** DOS date/time（固定 2026-11-11 00:00:00，保证产物可复现）。 */
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 11

function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const deflated = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 flag
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    locals.push(local, deflated)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + deflated.length
  }
  const centralSize = centrals.reduce((n, buffer) => n + buffer.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

/* ------------------------------------------------------------ 会话构造 */

const ZH = [
  '婚礼策划年度案',
  '预算超支预警',
  '供应商比选',
  '排期与场地',
  '客户沟通纪要',
  '邀请函文案',
  '灯光音响方案',
  '伴手礼清单',
  '摄影摄像档期',
  '复盘与改进',
  '压力测试大会话',
]

function iso(day, hour = 0) {
  return `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`
}

function conversation(id, title, day, turns, filler = '') {
  const messages = []
  let messageId = 0
  for (let turn = 1; turn <= turns; turn++) {
    messageId += 1
    messages.push({
      id: messageId,
      parent_id: messageId === 1 ? null : messageId - 1,
      role: 'USER',
      status: 'FINISHED',
      inserted_at: iso(day, turn % 23),
      fragments: [{ type: 'REQUEST', content: `第 ${turn} 轮提问：${title} 的要点是什么？${filler}` }],
    })
    messageId += 1
    messages.push({
      id: messageId,
      parent_id: messageId - 1,
      role: 'ASSISTANT',
      status: 'FINISHED',
      inserted_at: iso(day, turn % 23),
      fragments: [
        { type: 'THINK', content: `思考：围绕「${title}」拆解。`, elapsed_secs: 0.4 },
        { type: 'RESPONSE', content: `回答 ${turn}：${title} 的要点是预算、排期与审批红线。${filler}` },
      ],
    })
  }
  return {
    id,
    title,
    current_message_id: messageId,
    inserted_at: iso(day, 0),
    messages,
  }
}

mkdirSync(OUT, { recursive: true })

// 坏 JSON：截断的会话文件（导入器 parse 失败 → skipped，不阻断其它会话）。
const BROKEN_ID = 'conv-broken'
const broken = '{"id":"conv-broken","title":"坏 JSON 会话","messages":[{"id":1,'

// conv-01..09 正常；conv-10 超大（约 8MB 未压缩）；conv-11 补充正常会话。
const valid = []
for (let n = 1; n <= 9; n++) {
  const id = `conv-${String(n).padStart(2, '0')}`
  valid.push(conversation(id, ZH[n - 1], 10 - n, 6))
}
valid.push(conversation('conv-10', '压力测试大会话', 1, 1200, '（重复填充文本，用于验证大归档流式解析与内存上限）'.repeat(30)))

// 索引：坏会话排最前（最新），其余按 update 时间递减；11 条全部在 maxSessions 内。
const index = [
  { id: BROKEN_ID, inserted_at: iso(11), updated_at: iso(11) },
  ...valid.map((conv, position) => {
    const day = 10 - Math.min(position, 9)
    return { id: conv.id, inserted_at: iso(day), updated_at: iso(day) }
  }),
]

const entries = [
  { name: 'manifest.json', data: JSON.stringify({ export_format_version: 3 }) },
  { name: 'chat_session_index.json', data: JSON.stringify(index) },
  ...valid.map(conv => ({ name: `chat_sessions/${conv.id}.json`, data: JSON.stringify(conv) })),
  { name: 'chat_sessions/conv-broken.json', data: broken },
]
const archive = zip(entries)
const archivePath = join(OUT, 'deepseek-export-11.zip')
writeFileSync(archivePath, archive)

// 51 §1 字面夹具：10 行会话 NDJSON + 1 行坏 JSON（非上传格式，负向/解析用）。
const ndjson = [...valid.slice(0, 10).map(conv => JSON.stringify(conv)), '{"id":"conv-bad","title":'].join('\n') + '\n'
const ndjsonPath = join(OUT, 'sessions-10.ndjson')
writeFileSync(ndjsonPath, ndjson)

const oversizedBytes = Buffer.byteLength(JSON.stringify(valid.find(conv => conv.id === 'conv-10')))
process.stderr.write(
  `[chat-import-fixture] ${archivePath} (${archive.length} bytes, ${entries.length} entries, oversized conv-10=${oversizedBytes} bytes)\n`,
)
process.stderr.write(`[chat-import-fixture] ${ndjsonPath} (${Buffer.byteLength(ndjson)} bytes, 10 sessions + 1 bad line)\n`)
process.stderr.write('[chat-import-fixture] expected: 10 sessionIds; 1 skipped (conv-broken)\n')