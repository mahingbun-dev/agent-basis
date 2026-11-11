#!/usr/bin/env node
// G-CORE 验收 digest（机械比对，布尔+哈希输出；按会话逐事件精确解析——
// 2026-11-11 按判定代理第五轮复核意见重写：type=tool/call|tool/result 事件流、
// callId 配对、arguments JSON 串解析、isError 取自 result 内容）。
// 用法：node smoke/gate-digest.mjs
// 输出：smoke/gate-evidence/<id>/digest.json（每会话一份，按话术匹配门禁）

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PKG = process.cwd()
const REPO = resolve(PKG, '../..')
const EV = join(PKG, 'smoke/gate-evidence')
const HOME = join(REPO, '.eterna-gate-home')

const log = (line) => console.log(`[digest] ${line}`)

function newestSessionFiles() {
  const root = join(HOME, 'sessions')
  const found = []
  const scan = (dir, depth) => {
    if (depth > 3) return
    for (const f of readdirSync(dir)) {
      const p2 = join(dir, f)
      if (statSync(p2).isDirectory()) { scan(p2, depth + 1); continue }
      if (!f.startsWith('session.v4.jsonl.zstd')) continue
      found.push({ path: p2, mtime: statSync(p2).mtimeMs })
    }
  }
  scan(root, 0)
  found.sort((a, b) => b.mtime - a.mtime)
  return found
}

function decompress(p) {
  const r = spawnSync('zstd', ['-d', '-c', p], { maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`zstd 解压失败：${String(p)}`)
  return r.stdout.toString('utf8')
}

const PROMPTS = {
  'G-CORE-01': '打开 example.com 并读出页面标题',
  'G-CORE-02': '在 Hacker News 搜索 playwright，告诉我第一条结果的标题和链接',
  'G-CORE-03': '打开 IT之家首页（www.ithome.com），取快照后点开快照中第一条新闻链接，读出正文第一段',
}


/** 解析单会话：返回 { prompt, calls: [{name, args, isError, resultText}] } */
function parseSession(jsonl) {
  const events = []
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue
    try { events.push(JSON.parse(line)) } catch { continue }
  }
  // 用户话术（第一句用户消息）
  const userMsg = events.find((e) => { return e.type === 'user/message' || (e.type === 'request/header' && false) })
    ?? events.find((e) => { return e.type === 'assistant/message' }) // 兜底：从首条 assistant 前的对话推断
  let prompt = ''
  for (const e of events) {
    if (e.type === 'user/message') {
      const d = e.data ?? {}
      const c = d.content
      if (typeof c === 'string') { prompt = c; break }
      if (Array.isArray(c)) { prompt = c.map((blk) => { return blk?.text ?? '' }).join(' '); break }
      if (typeof d.message?.content === 'string') { prompt = d.message.content; break }
    }
  }
  // tool/call 与 tool/result 按 callId 配对
  const calls = []
  const pending = new Map()
  for (const e of events) {
    const d = e.data ?? {}
    if (e.type === 'tool/call' && typeof d.name === 'string' && d.name.startsWith('mcp__browser__browser_')) {
      let args = {}
      try { args = JSON.parse(d.arguments ?? '{}') } catch { args = { raw: d.arguments } }
      const rec = { name: d.name.replace('mcp__browser__', ''), turn: d.turn, step: d.step, args, isError: null, resultText: '' }
      calls.push(rec)
      pending.set(d.callId, rec)
    }
    if (e.type === 'tool/result') {
      const callId = d.message?.source?.callId ?? d.message?.toolCallId
      const rec = pending.get(callId)
      if (rec === undefined) continue
      const content = d.message?.content ?? []
      rec.resultText = content.map((c) => { return c.text ?? '' }).join('\n')
      try {
        const parsed = JSON.parse(rec.resultText)
        // isError 只认结构化字段（ok:false / isError:true），禁止字符串包含匹配——
        // 结果文本里的 JSON 键名（如 openedTabs.url 含 "error"）会造成误判（2026-11-11 实测）
        rec.isError = parsed.ok === false || parsed.isError === true
        rec.parsed = parsed
      } catch {
        rec.isError = false
      }
      pending.delete(callId)
    }
  }
  return { prompt, calls }
}

function sha(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `${s.length}ch:${(h >>> 0).toString(16)}`
}

function caseOf(prompt) {
  for (const [id, p] of Object.entries(PROMPTS)) {
    if (prompt.includes(p.slice(0, 20))) return id
  }
  return null
}

async function main() {
  const files = newestSessionFiles()
  log(`发现 ${String(files.length)} 个会话文件（按 mtime 降序）`)
  const byCase = {}
  const sessionMeta = []
  for (const f of files.slice(0, 6)) {
    const { prompt, calls } = parseSession(decompress(f.path))
    const id = caseOf(prompt)
    sessionMeta.push({ file: f.path.split('/').slice(-2)[0], mtime: new Date(f.mtime).toISOString(), case: id, promptHead: prompt.slice(0, 40), callCount: calls.length })
    if (id === null) continue
    if (byCase[id] === undefined || calls.length > 0) byCase[id] = { calls, session: f.path.split('/').slice(-2)[0] }
  }
  for (const m of sessionMeta) log(`会话 ${m.session} → ${m.case ?? '未知'}（调用 ${String(m.callCount)} 次）「${m.promptHead}」`)

  // ── G-CORE-02 ──────────────────────────────────────────────────────
  const g2 = byCase['G-CORE-02']
  if (g2 !== undefined) {
    const names = g2.calls.map((c) => { return c.name })
    const clickIdx = names.lastIndexOf('browser_click')
    const d2 = {
      session: g2.session,
      sequence: g2.calls.map((c) => { return `${c.name}${c.isError === true ? '!ERROR' : ''}(${c.turn}/${String(c.step)})` }),
      snapshotCount: names.filter((n) => { return n === 'browser_snapshot' }).length,
      fillCount: names.filter((n) => { return n === 'browser_fill' }).length,
      clickCount: names.filter((n) => { return n === 'browser_click' }).length,
      clickNoError: g2.calls.filter((c) => { return c.name === 'browser_click' }).every((c) => { return c.isError !== true }),
      orderSubsequence: (() => {
        const seq = ['browser_snapshot', 'browser_fill', 'browser_click']
        let idx = 0
        for (const c of g2.calls) {
          if (c.name === seq[idx] && c.isError !== true) idx++
          if (idx === 3) return true
        }
        return false
      })(),
      lastClickFollowedBySnapshot: (() => {
        if (clickIdx < 0) return false
        return names.slice(clickIdx + 1).some((n) => { return n === 'browser_snapshot' })
      })(),
      allNoError: g2.calls.every((c) => { return c.isError !== true }),
    }
    writeFileSync(join(EV, 'G-CORE-02/digest.json'), `${JSON.stringify(d2, null, 2)}\n`)
    log('G-CORE-02/digest.json 已写')
  }

  // ── G-CORE-03 ──────────────────────────────────────────────────────
  const g3 = byCase['G-CORE-03']
  if (g3 !== undefined) {
    const rec3 = JSON.parse(readFileSync(join(EV, 'G-CORE-03/record.json'), 'utf8'))
    const full3 = rec3.observations.find((o) => { return o.kind === 'session-full-text' })?.data ?? ''
    const clicks = g3.calls.filter((c) => { return c.name === 'browser_click' })
    // 判据 3 机械核验：click 的 ref 在紧邻前序 snapshot 的结果文本中存在
    const refCheck = clicks.map((c) => {
      const ref = c.args?.ref ?? ''
      if (ref === '') return { ref: '', present: false, note: 'click 无 ref 参数' }
      const clickIdx = g3.calls.indexOf(c)
      const priorSnap = [...g3.calls.slice(0, clickIdx)].reverse().find((x) => { return x.name === 'browser_snapshot' })
      const present = priorSnap !== undefined && priorSnap.resultText.includes(`[ref=${ref}]`)
      return { ref, present }
    })
    const openedTabsUrls = []
    for (const c of g3.calls) {
      const ot = c.parsed?.result?.openedTabs ?? c.parsed?.openedTabs
      if (Array.isArray(ot)) for (const t of ot) openedTabsUrls.push(t.url ?? '')
    }
    // 判据 2 机械比对：详情页基准首段 vs 会话全文包含性
    const tabsAfter = rec3.observations.find((o) => { return o.kind === 'tabs-after' })?.data?.pages ?? []
    const detailTab = tabsAfter.find((t) => { return /ithome\.com\/(\d|news|content)/.test(t.url) }) ?? tabsAfter.find((t) => { return /ithome\.com/.test(t.url) && !/www\.ithome\.com\/?$/.test(t.url) })
    let c2 = { attempted: false }
    if (detailTab !== undefined) {
      try {
        const detail = await fetch(detailTab.url, { signal: AbortSignal.timeout(30_000) }).then((r) => { return r.text() })
        const paras = [...detail.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((x) => { return x[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() })
        const firstPara = paras.find((p3) => { return p3.length >= 30 }) ?? ''
        c2 = {
          attempted: true,
          detailUrl: detailTab.url,
          baselineFirstParaLen: firstPara.length,
          baselineFirstParaSha: sha(firstPara),
          answerContainsBaseline: firstPara !== '' && full3.includes(firstPara.slice(0, 60)),
        }
      } catch (err) {
        c2 = { attempted: true, error: err instanceof Error ? err.message : String(err) }
      }
    }
    const d3 = {
      session: g3.session,
      sequence: g3.calls.map((c) => { return `${c.name}${c.isError === true ? '!ERROR' : ''}(${c.turn}/${String(c.step)})` }),
      clickCount: clicks.length,
      clickNoError: clicks.every((c) => { return c.isError !== true }),
      refCheck,
      openedTabsUrls,
      turnFailed: full3.includes('本轮运行失败'),
      criteria2: c2,
    }
    writeFileSync(join(EV, 'G-CORE-03/digest.json'), `${JSON.stringify(d3, null, 2)}\n`)
    log('G-CORE-03/digest.json 已写')
  }
  if (byCase['G-CORE-01'] === undefined) log('警告：G-CORE-01 会话未匹配（话术匹配前缀检查）')
}

await main().catch((err) => {
  console.error('[digest] 失败：', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
