// 多帧 zstd 会话日志解码(逐帧魔数扫描;与 packages/panel/src/session-logs.ts 同算法)。
// 用途:PH/P1/P4 门禁读取会话轨迹断言(approval 瀑布/工具结果/usage)。
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4247762216

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset); offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag)
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let lastBlock = false
    for (;;) {
      if (buffer.length - offset < 3) { lastBlock = true; break }
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3
      lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) { lastBlock = false; break }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) { lastBlock = true; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!lastBlock) break
    if (checksum) { if (buffer.length - offset < 4) break; offset += 4 }
    frames.push({ start, end: offset })
  }
  return frames
}

export function decodeZstdLog(buffer) {
  const frames = scanZstdFrames(buffer)
  if (frames.length === 0) throw new Error('no zstd frames found')
  return frames.map(f => zstdDecompressSync(buffer.subarray(f.start, f.end)).toString('utf8')).join('')
}

export function parseEvents(text) {
  return text.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** 轨迹摘要:approval 瀑布计数(含同毫秒自动拒签名)/工具调用与结果/回合终态。 */
export function summarizeEvents(events) {
  const asked = [], decided = [], toolCalls = [], toolResults = [], turnEnds = []
  for (const ev of events) {
    if (ev.type === 'approval/asked') asked.push({ at: ev.time, toolName: ev.data?.toolName })
    if (ev.type === 'approval/decided') decided.push({ at: ev.time, outcome: ev.data?.outcome })
    if (ev.type === 'tool/call') toolCalls.push({ name: ev.data?.name, callId: ev.data?.callId, turn: ev.data?.turn })
    if (ev.type === 'tool/result') toolResults.push({ isError: ev.data?.isError === true, callId: ev.data?.callId })
    if (ev.type === 'turn/end') turnEnds.push({ reason: ev.data?.reason })
  }
  // 同毫秒 asked→rejected 签名(I2 全拒特征)
  const autoRejects = decided.filter(d => d.outcome === 'rejected' && asked.some(a => a.at === d.at)).length
  return { askedCount: asked.length, autoRejectCount: autoRejects, toolCalls, toolResults, turnEnds }
}
