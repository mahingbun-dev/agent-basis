#!/usr/bin/env node
/**
 * T7.4 投影快照测试 fixture 生成器:从 T7.0 spike 的真实会话日志
 * (.eterna-home-t7/sessions/…,只读)解码 → 脱敏 → 落为 JSONL fixture。
 *
 * 脱敏规则(其余字段——type/seq/time/usage/stream/结构——逐字保留,钉死投影口径):
 *  1. system/message 与 title-llm-request 的宿主组合系统提示长文本:保留头部两段
 *     (含 spike persona 标记),其余以「…[脱敏:…]」截断;
 *  2. runtime-context / skill-catalog 用户消息长文本与技能目录 entries:截断/桩化;
 *  3. request/header 的工具 schema 列表:缩至前 2 条,description/parameters 桩化;
 *  4. 任何绝对路径中的 /Users/sunny → /Users/[user](兜底扫尾)。
 *
 * 用法:node scripts/gen-trace-fixture.mjs [源日志路径]
 * 源缺省 = .eterna-home-t7/sessions/--tmp-t7-spike-ws-48637--/session-fa97514a-b440-
 * 4e70-ac92-b2542283ca26/session.v4.jsonl.zstd(29 行:两轮「在线」会话,含
 * session/title 双标题、usage、无工具调用的真实形态)。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const require_ = createRequire(import.meta.url)
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(pkgRoot, '..', '..')
const SOURCE = process.argv[2]
  ?? resolve(repoRoot, '.eterna-home-t7/sessions/--tmp-t7-spike-ws-48637--/session-fa97514a-b440-4e70-ac92-b2542283ca26/session.v4.jsonl.zstd')
const TARGET = resolve(pkgRoot, 'tests/fixtures/t7-session-fa97514a-sanitized.jsonl')

const CENSOR = '…[脱敏]'

function decodeLog(buf) {
  // 多帧容器:帧扫描与 trace.ts 同算法(此处仅生成器用,one-shot 只出首帧不可用)
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const parts = []
  let off = 0
  while (off < buf.length) {
    const hit = buf.indexOf(MAGIC, off)
    if (hit < 0) break
    off = hit
    let end = -1
    try {
      // 逐帧边界由重试扫描确定:直接调用 one-shot 前先用启发式——本 fixture 由
      // dsh checkpoint 写出,帧尾即下一魔数或 EOF;此处简单以「下一个魔数」为界。
      const next = buf.indexOf(MAGIC, off + 4)
      const frame = buf.subarray(off, next < 0 ? buf.length : next)
      parts.push(zstdDecompressSync(frame).toString('utf8'))
      end = next < 0 ? buf.length : next
    } catch {
      throw new Error(`帧解码失败 @${off}(生成器只处理相邻魔数分界的整帧)`)
    }
    off = end
  }
  return parts.join('')
}

function truncateText(text, head, note) {
  if (typeof text !== 'string') return text
  return text.length <= head ? text : `${text.slice(0, head)}${note ?? CENSOR}`
}

const lines = decodeLog(readFileSync(SOURCE)).split('\n').filter((l) => l.trim().length > 0)
const out = lines.map((line) => {
  const event = JSON.parse(line)
  const data = event.data
  switch (event.type) {
    case 'system/message': {
      for (const block of data.message.content ?? []) {
        if (block.type === 'text') block.text = truncateText(block.text, 220, '\n…[脱敏:宿主组合系统提示全文省略]')
      }
      break
    }
    case 'user/message': {
      const source = data.source ?? {}
      if (source.kind === 'runtime-context') {
        data.content = data.content.map((b) => (b.type === 'text' ? { ...b, text: truncateText(b.text, 120, ' …[脱敏:运行时上下文快照省略]') } : b))
        source.sections = (source.sections ?? []).map((s) => ({ name: s.name, text: truncateText(s.text, 80) }))
      }
      if (source.kind === 'skill-catalog') {
        data.content = data.content.map((b) => (b.type === 'text' ? { ...b, text: '[脱敏:技能目录全文省略]' } : b))
        source.entries = (source.entries ?? []).slice(0, 1).map((e) => ({ name: e.name, description: CENSOR }))
      }
      break
    }
    case 'request/header': {
      const header = data.header
      header.tools = (header.tools ?? []).slice(0, 2).map((t) => ({ name: t.name, description: CENSOR, parameters: { type: 'object', properties: {}, required: [] } }))
      break
    }
    case 'session/title-llm-request': {
      data.system = truncateText(data.system, 120)
      break
    }
    default:
      break
  }
  return JSON.stringify(event)
})

let text = `${out.join('\n')}\n`
text = text.replaceAll('/Users/sunny/', '/Users/[user]/')
mkdirSync(dirname(TARGET), { recursive: true })
writeFileSync(TARGET, text)
console.log(`fixture written: ${TARGET} (${out.length} lines, from ${SOURCE})`)
