#!/usr/bin/env node
/**
 * WeKnora 适配器真连冒烟(T8 后置联调;配套 packages/knowledge/src/weknora.ts 映射校准)。
 *
 * 流程(全部真 HTTP,无 mock):
 *   1. 读凭据 .secrets/weknora-token.txt(gitignored;首行非 # 注释行即 JWT);
 *   2. 确保 tenant 有可用 embedding 模型(无则注册本机 ollama bge-m3,source=local,等 active;
 *      真连实证:embedder 仅支持 source local/remote,"ollama" 会报 unsupported embedder source);
 *   3. POST /api/v1/knowledge-bases 建 event-kb-smoke(挂 embedding_model_id);
 *   4. POST /api/v1/knowledge-bases/:id/knowledge/file 上传最小测试文档(含「预算」);
 *   5. 轮询 parse_status 至 completed(失败则带 error_message 退出);
 *   6. POST /api/v1/knowledge-search 检索「预算」,断言命中且 content 含关键词;
 *   7. 用真实命中载荷直跑 packages/knowledge/src/weknora.ts 的 mapSearchResponse(活体映射校准:
 *      title 必须取到 knowledge_title 而非回退 uuid、doc_id 必须取 knowledge_id 而非 chunk id);
 *   8. 清理:DELETE /api/v1/knowledge-bases/:id(finally 尽力删,失败不掩盖主错误)。
 *
 * 末尾打印 knowledge-search 真实响应的形态摘要(命中字段名清单),供与 weknora.ts
 * mapSearchResponse 的字段映射人工/脚本比对。退出码 0=全绿,非 0=失败。
 *
 * 运行:node scripts/weknora-smoke.mjs  (可 WEKNORA_BASE_URL 覆盖,默认 http://MaNas:8080)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = (process.env.WEKNORA_BASE_URL ?? 'http://MaNas:8080').replace(/\/+$/, '')
const TOKEN_FILE = join(ROOT, '.secrets', 'weknora-token.txt')
const KB_NAME = 'event-kb-smoke'
const DOC_MARKDOWN = '活动预算管理规范\n\n年度发布会预算总额不超过 50 万元,其中场地租赁预算占 30%,餐饮预算占 20%。预算变更超过 10% 需走审批流程。\n'
const DOC_FILENAME = 'docs/event-budget.md'
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 120_000

function log(step, detail) {
  console.log(`[${step}] ${detail}`)
}

function fail(step, detail) {
  console.error(`[${step}] FAIL: ${detail}`)
  process.exitCode = 1
  throw new Error(`${step}: ${detail}`)
}

function readToken() {
  let raw
  try {
    raw = readFileSync(TOKEN_FILE, 'utf8')
  } catch {
    fail('token', `无法读取 ${TOKEN_FILE}(先登录 POST /api/v1/auth/login,把 JWT 写入该文件;文件已 gitignore)`)
  }
  const token = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith('#'))
  if (!token) fail('token', `${TOKEN_FILE} 内无令牌行`)
  return token
}

async function api(path, { method = 'GET', token, body, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : form,
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { _raw: text.slice(0, 400) }
  }
  return { status: response.status, ok: response.ok, payload }
}

async function ensureEmbeddingModel(token) {
  const list = await api('/api/v1/models', { token })
  if (!list.ok || !Array.isArray(list.payload.data)) fail('models', `GET /api/v1/models -> HTTP ${list.status}`)
  const active = list.payload.data.filter((m) => m.type === 'embedding' && m.status === 'active')
  if (active.length > 0) {
    log('models', `复用已有 embedding 模型 ${active[0].name}(${active[0].id}, source=${active[0].source})`)
    return active[0].id
  }
  const created = await api('/api/v1/models', {
    method: 'POST',
    token,
    body: { name: 'bge-m3', type: 'embedding', source: 'local' },
  })
  if (!created.ok) fail('models', `注册 bge-m3(local) 失败: HTTP ${created.status} ${JSON.stringify(created.payload).slice(0, 300)}`)
  const modelId = created.payload.data?.id
  log('models', `已注册 embedding 模型 bge-m3(local) ${modelId},等待 active…`)
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const check = await api('/api/v1/models', { token })
    const m = (check.payload.data ?? []).find((x) => x.id === modelId)
    if (m?.status === 'active') return modelId
    if (m?.status === 'error') fail('models', `模型进入 error 态: ${JSON.stringify(m).slice(0, 300)}`)
  }
  fail('models', `模型 ${modelId} 等待 active 超时(${POLL_TIMEOUT_MS}ms)`)
}

async function createKb(token, embeddingModelId) {
  const res = await api('/api/v1/knowledge-bases', {
    method: 'POST',
    token,
    body: {
      name: KB_NAME,
      description: 'agent-basis WeKnora 适配器真连冒烟(临时,用后即删)',
      embedding_model_id: embeddingModelId,
    },
  })
  if (res.status !== 201 && !res.ok) fail('create-kb', `HTTP ${res.status} ${JSON.stringify(res.payload).slice(0, 300)}`)
  const kb = res.payload.data
  log('create-kb', `${kb.name} -> ${kb.id}(capabilities=${JSON.stringify(kb.capabilities)})`)
  return kb.id
}

async function uploadDoc(token, kbId) {
  const form = new FormData()
  form.append('file', new Blob([DOC_MARKDOWN], { type: 'text/markdown' }), 'event-budget.md')
  form.append('fileName', DOC_FILENAME)
  const res = await api(`/api/v1/knowledge-bases/${kbId}/knowledge/file`, { method: 'POST', token, form })
  if (!res.ok) fail('upload', `HTTP ${res.status} ${JSON.stringify(res.payload).slice(0, 300)}`)
  const knowledge = res.payload.data
  log('upload', `${knowledge.file_name} -> knowledge ${knowledge.id}(parse=${knowledge.parse_status})`)
  return knowledge.id
}

async function waitForProcessed(token, kbId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let last = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await api(`/api/v1/knowledge-bases/${kbId}/knowledge?page=1&page_size=10`, { token })
    const doc = res.payload.data?.[0]
    if (!doc) fail('poll', '知识列表为空(上传似乎未生效)')
    last = `${doc.parse_status}/${doc.enable_status}`
    log('poll', `parse_status=${doc.parse_status} enable_status=${doc.enable_status}`)
    if (doc.parse_status === 'completed' && doc.enable_status === 'enabled') return doc
    if (doc.parse_status === 'failed') fail('poll', `文档解析失败: ${doc.error_message}`)
  }
  fail('poll', `等待 processed 超时,最后状态 ${last}`)
}

async function searchBudget(token, kbId) {
  const body = {
    query: '预算',
    knowledge_base_ids: [kbId],
    match_count: 8,
    rerank: { enabled: true },
  }
  const res = await api('/api/v1/knowledge-search', { method: 'POST', token, body })
  if (!res.ok) fail('search', `HTTP ${res.status} ${JSON.stringify(res.payload).slice(0, 300)}`)
  const { success, data } = res.payload
  if (success !== true || !Array.isArray(data)) fail('search', `响应形态异常: success=${success} data=${typeof data}`)
  log('search', `query=预算 -> ${data.length} 命中`)
  if (data.length === 0) fail('search', '零命中(文档已 completed/enabled 却检索不到,检查索引)')
  const first = data[0]
  if (!String(first.content ?? '').includes('预算')) fail('search', `首命中 content 不含「预算」: ${String(first.content).slice(0, 120)}`)
  log('search-shape', `首命中字段: ${Object.keys(first).join(', ')}`)
  log('search-sample', JSON.stringify({
    id: first.id,
    knowledge_id: first.knowledge_id,
    knowledge_title: first.knowledge_title,
    knowledge_filename: first.knowledge_filename,
    content: first.content,
    score: first.score,
    match_type: first.match_type,
    chunk_index: first.chunk_index,
    metadata: first.metadata,
  }))
  return res.payload
}

/** 活体映射校准:真实命中载荷直跑 packages/knowledge/src/weknora.ts 的 mapSearchResponse。 */
async function checkLiveMapping(livePayload) {
  const first = livePayload.data[0]
  const { mapSearchResponse } = await import(pathToFileURL(join(ROOT, 'packages/knowledge/src/weknora.ts')).href)
  const hits = mapSearchResponse(livePayload, 8)
  if (hits.length === 0) fail('map', 'mapSearchResponse 对真实载荷产出 0 命中(字段映射漂移)')
  const hit = hits[0]
  if (hit.title !== first.knowledge_title) fail('map', `title 映射漂移:期望 knowledge_title=${first.knowledge_title},实际 ${hit.title}(疑似回退 docId)`)
  if (hit.ref.doc_id !== first.knowledge_id) fail('map', `doc_id 映射漂移:期望 knowledge_id=${first.knowledge_id},实际 ${hit.ref.doc_id}(疑似误用 chunk id)`)
  if (!Number.isFinite(hit.score)) fail('map', `score 非有限数: ${String(hit.score)}`)
  log('map', `mapSearchResponse(真实载荷) → title=${hit.title} doc_id=${hit.ref.doc_id} score=${hit.score.toFixed(6)} trust=${hit.provenance.trust}`)
}

async function main() {
  const token = readToken()
  log('token', `已载入 ${TOKEN_FILE}(len=${token.length})`)
  const embeddingModelId = await ensureEmbeddingModel(token)
  let kbId
  try {
    kbId = await createKb(token, embeddingModelId)
    await uploadDoc(token, kbId)
    await waitForProcessed(token, kbId)
    const livePayload = await searchBudget(token, kbId)
    await checkLiveMapping(livePayload)
  } finally {
    if (kbId) {
      const del = await api(`/api/v1/knowledge-bases/${kbId}`, { method: 'DELETE', token })
      log('cleanup', del.ok ? `已删测试库 ${kbId}` : `删库失败 HTTP ${del.status}(手工清理: DELETE /api/v1/knowledge-bases/${kbId})`)
    }
  }
  console.log('\nSMOKE OK: 建库→上传→解析→检索「预算」命中→活体映射校准→清理 全链路真实通过')
}

main().catch((error) => {
  console.error(`SMOKE FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(process.exitCode ?? 1)
})
