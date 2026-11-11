#!/usr/bin/env node
/**
 * T5 真会话性能测量（网关直连，OpenAI 兼容 /chat/completions）。
 *
 * 口径（与 docs/perf-baseline.md 一致）：KV-cache 命中率、首 token 延迟是
 * 模型与网关侧指标，与宿主 profile 组合无关；宿主侧 token/成本计量由
 * observe 插件与会话日志承担。本脚本补齐基线的「真会话侧」：
 *
 *   run1 = 前缀 P + Q1            → 冷调用（缓存写入）
 *   run2 = 前缀 P + Q2（更长）    → 共享前缀命中（cacheRead 期望 > 0）
 *   run3 = run2 同负载原样重放    → 命中率上限参考
 *   ttft = run1 的流式版          → 首 token 延迟（首条含 content 的增量块）
 *
 * 前缀 P 为确定性文本（约 1.6KB / 数百 token，远超 DeepSeek 缓存 64-token 块粒度）。
 *
 * 凭据纪律：MIMO_API_KEY 从启动环境读（缺省兜底 .secrets/mimo-api-key.txt），
 * 网关 BASE_URL 从 MIMO_BASE_URL(可空,默认固化直连) 读（缺省兜底 .secrets/mimo 直连 baseURL(固化).txt）；
 * key 只进请求头，不进日志/落盘文件/argv。
 *
 * 退出码：0 = 测量完成并写入 docs/perf-realsession.json；1 = 网关调用失败。
 * 用法：node scripts/perf-realsession.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readSecret = (file) => {
  try {
    return readFileSync(resolve(repoRoot, '.secrets', file), 'utf8').trim()
  } catch {
    return ''
  }
}

const apiKey = process.env.MIMO_API_KEY || readSecret('mimo-api-key.txt')
const baseUrl = (process.env.MIMO_BASE_URL(可空,默认固化直连) || 'https://api.xiaomimimo.com/v1').replace(/\/$/, '')
if (!apiKey || !baseUrl) {
  console.error('perf-realsession: 缺少 MIMO_API_KEY 或 MIMO_BASE_URL(可空,默认固化直连)（且 .secrets 兜底不可读）——如实失败，不伪造')
  process.exit(1)
}
const MODEL = 'deepseek-flash'

// 确定性稳定前缀：领域上下文（工业测点台账约定），每次调用逐字相同 → 可被前缀缓存。
const PREFIX = [
  '你是某制造企业的设备数据分析助手。以下是测点台账约定（稳定上下文，勿复述）：',
  '1. 测点命名 = <机组号>.<系统>.<设备>.<测点>，例如 1.Boiler.FD01.BearingTemp；',
  '2. 时序库 TDengine 超级表按系统分库，保留策略：原始 90 天 / 降采样 2 年；',
  '3. 预警等级：L1 跳机风险（5 分钟响应）、L2 性能劣化（2 小时）、L3 提示（下一班）；',
  '4. 达梦业务库只读，写入仅限预警记录表 alert_record；',
  '5. 所有结论必须带测点出处与时间窗，不确定时明确说数据不足；',
  '6. 单位约定：温度 ℃、压力 MPa、流量 t/h、振动 mm/s（RMS）。',
  '7. 趋势描述使用「上升/下降/平稳/周期波动」四档，幅度用百分比。',
  '8. 报告输出异步化：任务队列 + 进度回报 + 产物落对象存储 + 前端下载。',
  '9. 知识检索只经 Knowledge MCP（pgvector + 图谱），不直连知识库。',
  '10. 语音在前端完成 ASR 转写，TTS 仅播报关键结论。',
].join('\n')

const call = async (messages, { stream = false, signal } = {}) => {
  const started = performance.now()
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 400, temperature: 0, stream }),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  if (!stream) {
    const json = await res.json()
    return { latencyMs: Math.round(performance.now() - started), usage: json.usage ?? {}, content: json.choices?.[0]?.message?.content ?? '' }
  }
  // 流式：量首 token 延迟，同时收完整回复与 usage（OpenAI 兼容流末帧带 usage）。
  let ttftMs = null
  let content = ''
  let usage = {}
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const idx = buffer.indexOf('\n')
      if (idx < 0) break
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const evt = JSON.parse(payload)
        const delta = evt.choices?.[0]?.delta?.content
        if (delta) {
          if (ttftMs === null) ttftMs = Math.round(performance.now() - started)
          content += delta
        }
        if (evt.usage) usage = evt.usage
      } catch { /* 非 JSON 行忽略 */ }
    }
  }
  return { latencyMs: Math.round(performance.now() - started), ttftMs, usage, content }
}

const cacheFields = (u) => ({
  promptTokens: u.prompt_tokens ?? null,
  completionTokens: u.completion_tokens ?? null,
  // MiMo 直连 归一化字段与 DeepSeek 原生字段双兼容读取。
  cacheRead: u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? null,
  cacheWrite: u.cache_creation_input_tokens ?? null,
  totalTokens: u.total_tokens ?? null,
})

const runs = []
const nonStream = async (id, messages) => {
  const r = await call(messages)
  runs.push({ id, kind: 'non-stream', latencyMs: r.latencyMs, ...cacheFields(r.usage) })
  console.log(`${id}: ${r.latencyMs}ms, usage=${JSON.stringify(cacheFields(r.usage))}`)
  return r
}

try {
  const q1 = '问：1.Boiler.FD01.BearingTemp 过去 24h 趋势如何？一句话回答。'
  const q2 = q1 + '\n问：若该测点 2h 内上升 8%，按台账应定几级预警？一句话回答。'

  const run1 = await nonStream('run1-cold', [{ role: 'system', content: PREFIX }, { role: 'user', content: q1 }])
  const run2 = await nonStream('run2-prefix-hit', [{ role: 'system', content: PREFIX }, { role: 'user', content: q2 }])
  const run3 = await nonStream('run3-replay', [{ role: 'system', content: PREFIX }, { role: 'user', content: q2 }])

  const s = await call([{ role: 'system', content: PREFIX }, { role: 'user', content: q1 }], { stream: true })
  runs.push({ id: 'ttft-stream', kind: 'stream', ttftMs: s.ttftMs, latencyMs: s.latencyMs, ...cacheFields(s.usage) })
  console.log(`ttft-stream: 首 token ${s.ttftMs}ms, 总 ${s.latencyMs}ms, usage=${JSON.stringify(cacheFields(s.usage))}`)

  const rate = (u) => (u.promptTokens && u.cacheRead !== null ? u.cacheRead / u.promptTokens : null)
  const summary = {
    generatedAt: new Date().toISOString(),
    gateway: baseUrl,
    model: MODEL,
    prefixChars: PREFIX.length,
    runs,
    cache: {
      run2HitRate: rate(runs[1]),
      run3HitRate: rate(runs[2]),
      note: 'run2/run3 与 run1 共享前缀 P；命中率 = cacheRead / promptTokens',
    },
    ttftMs: s.ttftMs,
  }
  writeFileSync(resolve(repoRoot, 'docs', 'perf-realsession.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(`perf-realsession: OK → docs/perf-realsession.json（run3 命中率 ${summary.cache.run3HitRate ?? 'n/a'}）`)
  process.exitCode = 0
} catch (err) {
  console.error(`perf-realsession: FAILED — ${err.message}`)
  process.exit(1)
}
