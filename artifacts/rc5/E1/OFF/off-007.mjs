#!/usr/bin/env node
/**
 * E1 · RC5-OFF-007：加载 office-docx 技能 → 三个办公室工具下一步出现 → 产物可复制回工作区。
 *
 * 链路：E1 容器（3118）+ 本机确定性假模型（4603）：
 *   1) skill{name:'office-docx'} —— 技能可加载；
 *   2) 下一请求的 tools 清单出现 office_render/office_convert/office_recalculate；
 *   3) office_render 渲染工作区样本（工具真实执行，结果非错）；
 *   4) office_convert 转 PDF，临时产物存在；
 *   5) bash 把临时产物复制回工作区（产品文档规定的下一步），工作区文件落盘。
 *
 * 前提：E1 容器为最终镜像；样本 docx 由测试用 docker cp 放进 B 工作区。
 * 用法：node artifacts/rc5/E1/OFF/off-007.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, REPO, call, docker, sleep } from '../_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '../../../../scripts/rc5-test-client.mjs'

const PORT = 4603
const WS = '/data/workspaces/rc5userb'
const SAMPLE = `${WS}/off-007-sample.docx`
const OUT_DIR = `${WS}/off-007`
const LOG = join(LANE.evidenceRoot, 'OFF', 'tmp', 'fake-llm-off007.jsonl')

function provider() {
  return {
    displayName: 'RC5 Fake OFF（确定性验收夹具）',
    apiKeyEnv: 'FAKE_LLM_API_KEY',
    api: 'openai-completions',
    baseURL: `http://host.docker.internal:${PORT}/v1`,
    models: [{
      id: 'fake-1', name: 'Fake 1', contextWindow: 128000, maxTokens: 4096, input: ['text', 'image'],
      compat: { supportsDeveloperRole: true, requiresReasoningContentOnAssistantMessages: false, maxTokensField: 'max_tokens' },
    }],
  }
}

async function ensureRoute(cookie) {
  const write = await call(cookie, 'settings/update', {
    request: { ns: 'llm-pi-ai', patch: { providers: { fake: provider() } } },
  }, { timeoutMs: 30_000 })
  const model = await call(cookie, 'settings/update', {
    request: { ns: 'agent-default-model', patch: { provider: 'fake', model: 'fake-1' } },
  }, { timeoutMs: 30_000 })
  const catalog = await call(cookie, 'session/modelCatalog', {}, { timeoutMs: 30_000 })
  return {
    write, model,
    routable: (catalog.value?.routableProviders ?? []).includes('fake'),
  }
}

async function cleanupRoute(cookie) {
  await call(cookie, 'settings/update', {
    request: { ns: 'agent-default-model', patch: { provider: 'mimo', model: 'mimo-v2.6-pro' } },
  }, { timeoutMs: 30_000 }).catch(() => undefined)
  const describe = await call(cookie, 'settings/describe', {}, { timeoutMs: 30_000 })
  const ns = (describe.value?.namespaces ?? []).find(row => row.ns === 'llm-pi-ai')
  const providers = { ...(ns?.value?.providers ?? {}) }
  delete providers.fake
  await call(cookie, 'settings/replace', { request: { ns: 'llm-pi-ai', value: { providers } } }, { timeoutMs: 30_000 })
    .catch(() => undefined)
}

async function waitIdle(cookie, sessionId, { timeoutMs = 180_000, sinceCursor = 0 } = {}) {
  const t0 = Date.now()
  for (;;) {
    const state = await call(cookie, 'session/state', { sessionId }, { timeoutMs: 20_000 })
    const value = state.value ?? {}
    const advanced = typeof value.cursor === 'number' && value.cursor > sinceCursor
    if (advanced && value.running === false && (value.queue ?? []).length === 0) return value
    if (Date.now() - t0 > timeoutMs) throw new Error(`回合超时：${JSON.stringify(value).slice(0, 300)}`)
    await sleep(1_000)
  }
}

function logRows(mark) {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(mark)
    .map(line => JSON.parse(line))
}

const c = new Case('OFF', 'RC5-OFF-007')
let child
let sessionId
let cookieB
let cookieAdmin
try {
  mkdirSync(join(LANE.evidenceRoot, 'OFF', 'tmp'), { recursive: true })
  rmSync(LOG, { force: true })

  /* 夹具：样本 docx 进 B 工作区 */
  const cp = docker(['cp', join(REPO, 'tests/fixtures/office/sample.docx'), `${LANE.container}:${SAMPLE}`])
  const chmod = docker(['exec', LANE.container, 'chmod', '644', SAMPLE])
  c.cmd(`docker cp tests/fixtures/office/sample.docx ${LANE.container}:${SAMPLE}`, cp.exit, shape(cp.stderr, 200))
  c.cmd(`docker exec ${LANE.container} chmod 644 ${SAMPLE}`, chmod.exit)

  /* 假模型：独立端口/日志，避免与 E2 LLM 套件串 */
  child = spawn(process.execPath, [join(REPO, 'artifacts/rc5/E2/LLM/fake-llm-server.mjs')], {
    env: { ...process.env, PORT: String(PORT), FAKE_LLM_LOG: LOG },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', () => undefined)
  let up = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(800) })
      if (response.ok) { up = true; break }
    } catch { /* not ready */ }
    await sleep(200)
  }
  c.cmd(`PORT=${PORT} FAKE_LLM_LOG=… node artifacts/rc5/E2/LLM/fake-llm-server.mjs`, up ? 0 : 1, `healthz=${up}`)

  /* 账号：B 建会话；admin 写 fake 路由 */
  const accounts = loadAccounts(LANE.accountsFile)
  const dsh = await bootstrapDshSession(LANE.base, bootTokenFromContainer(LANE.container))
  const admin = await login(LANE.base, accounts.admin.account, accounts.admin.password)
  const userB = await login(LANE.base, accounts.user_b.account, accounts.user_b.password)
  cookieAdmin = `${dsh}; ${admin.cookie}`
  cookieB = `${dsh}; ${userB.cookie}`
  const route = await ensureRoute(cookieAdmin)
  c.cmd('settings/update llm-pi-ai.providers.fake + agent-default-model=fake/fake-1', route.write.ok && route.model.ok ? 200 : 500,
    `write=${route.write.ok} model=${route.model.ok} routable=${route.routable}`)

  const created = await call(cookieB, 'session/create', { request: { cwd: WS } }, { timeoutMs: 30_000 })
  sessionId = created.value?.sessionId
  c.cmd(`POST /api/session/create {cwd:${WS}}（B）`, created.ok ? 200 : 500, `sessionId=${sessionId ?? '-'}`)
  if (sessionId === undefined) throw new Error('session/create 失败')

  const before = await call(cookieB, 'session/state', { sessionId }, { timeoutMs: 20_000 })
  const mark = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length : 0
  const prompt = await call(cookieB, 'session/prompt', {
    request: {
      requestId: `off007-${Date.now().toString(36)}`,
      sessionId,
      mode: 'queue',
      clientTimeZone: 'Asia/Shanghai',
      content: [{ type: 'text', text: [
        '@@SEQ 1',
        'RC5-OFF-007：加载 office-docx 技能，渲染并转换工作区里的样本，然后把 PDF 复制回工作区。',
        '@@CALL name=skill args={"name":"office-docx"}',
        `@@CALL name=office_render args={"input":"${SAMPLE}"}`,
        `@@CALL name=office_convert args={"input":"${SAMPLE}","format":"pdf"}`,
        `@@CALL name=bash args={"description":"Copy converted PDF into workspace","command":"mkdir -p ${OUT_DIR} && f=$(find /data/office-kit/outputs -name '*.pdf' -type f | head -1) && cp \\"$f\\" ${OUT_DIR}/sample.pdf && ls -l ${OUT_DIR}/sample.pdf"}`,
      ].join('\n') }],
    },
  }, { timeoutMs: 30_000 })
  c.cmd('POST /api/session/prompt（skill→render→convert→bash 复制）', prompt.ok ? 200 : 500,
    `ok=${prompt.ok} code=${prompt.error?.code ?? '-'} msg=${shape(prompt.error?.message, 160)}`)
  const state = await waitIdle(cookieB, sessionId, { sinceCursor: before.value?.cursor ?? 0 })
  const rows = logRows(mark)
  c.cmd('session/state 收尾（running=false，队列空）', 200, `cursor=${state.cursor}`)

  const pendingRows = rows.filter(row => row.pending !== null && row.pending !== undefined)
  const skillRow = pendingRows.find(row => row.pending?.name === 'skill')
  const renderRow = pendingRows.find(row => row.pending?.name === 'office_render')
  const convertRow = pendingRows.find(row => row.pending?.name === 'office_convert')
  const bashRow = pendingRows.find(row => row.pending?.name === 'bash')
  const skillIndex = skillRow === undefined ? -1 : rows.indexOf(skillRow)
  const afterSkillTools = rows.slice(skillIndex + 1).find(row => (row.toolNames ?? []).includes('skill'))?.toolNames ?? []
  const toolNamesUnion = [...new Set(rows.flatMap(row => row.toolNames ?? []))]
  const skillLoaded = rows.some(row => (row.toolResultTexts ?? []).some(text => /python-docx|Word documents/.test(text)))
  const resultAfter = (row, pattern) => {
    if (row === undefined) return ''
    for (const later of rows.slice(rows.indexOf(row) + 1)) {
      const hit = (later.toolResultTexts ?? []).filter(text => pattern.test(text)).at(-1)
      if (hit !== undefined) return hit
    }
    return ''
  }
  const renderResult = resultAfter(renderRow, /^Rendered /)
  const convertResult = resultAfter(convertRow, /^Converted /)
  const bashResult = resultAfter(bashRow, /sample\.pdf/)
  c.cmd('假模型日志：逐请求 pending/absent/toolNames', 0, shape(JSON.stringify(pendingRows.map(row => ({
    name: row.pending?.name, absent: row.absent, tools: (row.toolNames ?? []).length,
  }))), 500))
  c.cmd('技能结果（下一步工具清单）', 0, `afterSkillTools=${JSON.stringify(afterSkillTools)}`)
  c.cmd('office_render 结果片段', 0, shape(renderResult, 400))
  c.cmd('office_convert 结果片段', 0, shape(convertResult, 400))
  c.cmd('bash 结果片段', 0, shape(bashResult, 400))

  const listing = docker(['exec', LANE.container, 'sh', '-c',
    'find /data/office-kit/outputs -name \'*.pdf\' -type f | while read f; do echo "$f $(wc -c < "$f")"; done; echo ---; ls -l /data/workspaces/rc5userb/off-007/ 2>/dev/null'])
  c.cmd('docker exec 查看 office 输出与工作区复制件', listing.exit, shape(listing.stdout, 600))
  const convertMatch = /^Converted .*? to pdf \((\d+) bytes, \d+ page\): (\S+)/m.exec(convertResult)
  const convertedBytes = Number.parseInt(convertMatch?.[1] ?? '', 10)
  const convertedPath = convertMatch?.[2]
  const outputOnDisk = convertedPath !== undefined && listing.stdout.includes(convertedPath)
  const copiedPdf = /sample\.pdf/.test(listing.stdout)
  const copiedStat = docker(['exec', LANE.container, 'sh', '-c', `head -c 4 ${OUT_DIR}/sample.pdf 2>/dev/null; echo; stat -c %s ${OUT_DIR}/sample.pdf 2>/dev/null`])
  c.cmd(`docker exec head -c 4 ${OUT_DIR}/sample.pdf; stat -c %s`, copiedStat.exit, shape(copiedStat.stdout, 120))
  const copiedBytes = Number.parseInt(copiedStat.stdout.trim().split('\n').filter(Boolean).pop() ?? '', 10)

  c.assert('假模型与工具管线就绪（4 次工具请求全部发出）', pendingRows.length === 4, `pending=${pendingRows.length}`)
  c.assert('skill 可加载 office-docx（结果含技能正文）', skillRow !== undefined && skillRow.absent === false && skillLoaded,
    `absent=${skillRow?.absent} skillLoaded=${skillLoaded}`)
  c.assert('下一步工具清单出现 office_render/convert/recalculate',
    ['office_render', 'office_convert', 'office_recalculate'].every(name => afterSkillTools.includes(name)),
    JSON.stringify(afterSkillTools))
  c.assert('office_render 已注册并真实产出页面（非 absent/非错）',
    renderRow !== undefined && renderRow.absent === false && /^Rendered \d+ image/m.test(renderResult.trim()),
    `absent=${renderRow?.absent} result=${shape(renderResult, 200)}`)
  c.assert('office_convert 已注册并产出 PDF 临时文件', convertRow !== undefined && convertRow.absent === false
    && convertedPath !== undefined && convertedBytes > 0 && outputOnDisk,
    `absent=${convertRow?.absent} pdf=${convertedPath ?? '-'} bytes=${convertedBytes || '-'} onDisk=${outputOnDisk}`)
  c.assert('bash 复制产物回工作区成功', bashRow !== undefined && bashRow.absent === false
    && /sample\.pdf/.test(bashResult) && copiedPdf,
    `absent=${bashRow?.absent} hasSample=${/sample\.pdf/.test(bashResult)} listingCopy=${copiedPdf} resultTail=${shape(bashResult.slice(-160), 160)}`)
  c.assert('工作区复制件是有效 PDF 且非空', copiedBytes > 1_000, `bytes=${copiedBytes}`)

  const pass = pendingRows.length === 4 && skillRow?.absent === false && skillLoaded
    && ['office_render', 'office_convert', 'office_recalculate'].every(name => afterSkillTools.includes(name))
    && renderRow?.absent === false && /^Rendered \d+ image/m.test(renderResult.trim())
    && convertRow?.absent === false && convertedPath !== undefined && convertedBytes > 0 && outputOnDisk
    && bashRow?.absent === false && /sample\.pdf/.test(bashResult)
    && copiedPdf && copiedBytes > 1_000
  c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: 'office-docx 技能加载 + 三工具下一步出现 + 产物复制回工作区',
    expected: '技能可加载；office_render/convert/recalculate 下一步出现；产物可复制回工作区',
    actual: `skillLoaded=${skillLoaded} nextTools=${JSON.stringify(afterSkillTools)} render=${renderRow?.absent === false} `
      + `convert=${convertRow?.absent === false} pdf=${convertedPath ?? '-'}(${convertedBytes || '-'}B) onDisk=${outputOnDisk} bashCopy=${/sample\.pdf/.test(bashResult)} `
      + `workspacePdf=${copiedBytes}B`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）；假模型端口 ${PORT}（独立日志，避免与 E2 LLM 套件串）`,
      '模型选哪个工具被确定性化（@@CALL），工具清单/权限门/工具执行/产物全部走产品代码',
      'office-docx 技能由 web-app 的 skill-office 行从包内 assets 挂载；tool-office 以 activationSkills 默认清单（office/office-docx/office-xlsx/office-pptx）激活',
      '临时输出在 DSH_HOME/office-kit/outputs；按产品文档用 bash 复制到工作区（测试另以 docker exec 复核 PDF 头与大小）',
    ],
    artifacts: ['cmd.log'],
  })
  console.log(`[OFF-007] ${pass ? 'PASS' : 'FAIL'}`)
} finally {
  if (sessionId !== undefined && cookieB !== undefined) {
    await call(cookieB, 'session/delete', { request: { sessionId } }).catch(() => undefined)
  }
  if (child !== undefined) {
    child.kill('SIGTERM')
    await sleep(300)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  docker(['exec', LANE.container, 'rm', '-f', SAMPLE], { timeout: 30_000 })
  docker(['exec', LANE.container, 'rm', '-rf', OUT_DIR], { timeout: 30_000 })
  if (cookieAdmin !== undefined) {
    await cleanupRoute(cookieAdmin).catch(() => undefined)
  }
}