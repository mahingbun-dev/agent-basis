/**
 * rc.5 API-005/006/007 真宿主 harness（跑在测试容器内的独立 dsh 进程里）。
 *
 * 进程形态：官方 dsh `base + web-app` bundle 上的自定义 profile（隔离 DSH_HOME），
 * 挂载真实 @eterna/tasks 插件（createTasks 真实装配）+ 本插件。宿主服务
 * （sessionController / workspaceRegistry / permissionPresets / sessionPersistence /
 * agents / tools / systemPrompt）全部来自真实 dsh 装配，不是 fixture manager。
 *
 * 做的事：
 *  1. 在主会话（orchestrator-<realm>）上产生两条 webchat Trigger，经真实 Engine accept
 *     出两张工单 → DshExecutor 建两条真实 worker session（`worker-<ticketId>`）。
 *  2. 在 worker A 的真实 Agent 上经真实 SubagentRuntime 派生 2 个 in-process 子代理，
 *     调用真实 `waitForTreeWork(workerA)`，等两个子代理全部结束；回读 worker session
 *     持久史，断言两条 `subagent-settled` 回执都在（completed，sender 对得上）。
 *  3. 调用真实 `listDescendants(workerA.id)`，断言与派生的树一致。
 *  4. 在 worker B 上派生 1 个子代理，调用真实 `drainDescendants([workerB])`，断言
 *     目录里每个后代都已无驻留 Agent（无残留 running）。
 *  5. 结果写 results.json（不含凭据，仅 id/状态/时间）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'

export const name = 'eterna-api-harness'
export const inject = ['tasks', 'agents', 'subagents', 'sessionController', 'sessionPersistence']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => new Date().toISOString()
const lines = []
const log = (...parts) => {
  const line = `[${now()}] ${parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ')}`
  lines.push(line)
  console.log(line)
}
const withTimeout = (promise, ms, what) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${what} 超时 ${ms}ms`)), ms)
  promise.then(value => { clearTimeout(timer); resolve(value) },
    error => { clearTimeout(timer); reject(error) })
})
const statusOf = (agent) => agent ? agent.status : 'absent'

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== null && value !== false) return value
    if (Date.now() > deadline) throw new Error(`${what} 等待超时 ${ms}ms`)
    await sleep(200)
  }
}

/** 回读某 session 的持久事件（flush 后逐页读）。 */
async function readHistory(persistence, session) {
  await persistence.flush(session)
  const handle = await persistence.open(session.id, 'read')
  try {
    const events = []
    let offset = 0
    for (;;) {
      const page = await handle.read(offset, 512)
      const chunk = page.events ?? []
      if (!chunk.length) break
      events.push(...chunk)
      offset += chunk.length
      if (chunk.length < 512) break
    }
    return events
  } finally {
    await handle.close()
  }
}

/** worker session 史里的 subagent 终态回执（rc.5 `subagent-settled` source）。 */
function settlementReceipts(events) {
  return events.flatMap((event) => {
    if (event.type !== 'user/message') return []
    const source = event.data?.source
    if (!source || source.kind !== 'subagent-settled') return []
    const text = (event.data.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
    return [{ stopReason: source.stopReason, sender: String(source.senderSessionId ?? ''), text }]
  })
}


/**
 * 测试替身 LLM：测试容器只有占位凭据（DEEPSEEK_API_KEY 空、MIMO_API_KEY 为 31 字符占位，
 * 首跑实测 401 Invalid API Key），因此真实模型回合无法完成。这里注册一个确定性的 stub
 * 适配器，让 **真实 tasks worker / 真实 SubagentManager** 的回执与等待路径可被驱动；
 * 模型文本本身不是被测对象。真模型复跑缺口在 LaneReport 里以 P0 leftover 记录。
 */
function createStubAdapter() {
  const MODELS = [{ id: 'stub-fast', name: 'Deterministic Stub', inputModalities: ['text'] }]
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('stub aborted')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve() }, ms)
    const stop = () => { clearTimeout(timer); reject(new Error('stub aborted')) }
    signal?.addEventListener('abort', stop, { once: true })
  })
  const lastText = (messages) => (messages ?? []).flatMap(message =>
    (message.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '')).join('\n')
  return {
    providerInfo: (provider) => ({ id: provider, name: 'Deterministic Stub' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => image,
    listModels: async (provider) => MODELS.map(model => ({ provider, ...model })),
    resolveModel: async (provider, model) => ({
      provider, id: model, name: 'Deterministic Stub', inputModalities: ['text'],
      context: { contextWindow: 100_000 }, defaultMaxTokens: 4096,
    }),
    prepareCall: async (provider, model) => ({
      model: { provider, id: model, name: 'Deterministic Stub', inputModalities: ['text'],
        context: { contextWindow: 100_000 }, defaultMaxTokens: 4096 },
      stream: (options) => adapterStream(options),
    }),
    stream: (options) => adapterStream(options),
  }
  function adapterStream(options) {
    return (async function* stream() {
      const text = lastText(options.messages)
      let reply = 'REPORT: stub worker done'
      let waitMs = 0
      if (text.includes('DONE-1')) { reply = 'DONE-1'; waitMs = 2_000 }
      else if (text.includes('DONE-2')) { reply = 'DONE-2'; waitMs = 8_000 }
      else if (text.includes('sleep 120')) { reply = 'SLEPT'; waitMs = 60_000 }
      // worker 的首个 assignment 回合保持 2s 在跑：让 tasks executor 在它结束时
      // 才第一次查看后台树，从而真正 join 正在跑的子代理（而非空树快返回）。
      else if (text.includes('worker-a done')) { waitMs = 2_000 }
      else if (text.includes('worker-b done')) { waitMs = 2_000 }
      if (waitMs > 0) await delay(waitMs, options.signal)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
}

async function run(ctx, config) {
  const outDir = config.outDir ?? '/tmp/api-run-home/out'
  mkdirSync(outDir, { recursive: true })
  const report = {
    case: 'RC5-API-005/006/007',
    startedAt: now(),
    environment: { dsh: '0.2.2-rc.5', profile: 'api-prof', dshHome: process.env.DSH_HOME, node: process.version,
      llm: 'deterministic stub (test container has no usable provider credential)', master: 'orchestrator-ApiHarness',
      note: 'stub 只替代模型文本；tasks worker/session/subagent manager 均为真实 rc.5 装配' },
    checks: {},
    dispatch: [],
    spawns: [],
    receipts: [],
    descendants: {},
    drain: {},
    statuses: {},
    errors: [],
  }
  const subagentEnds = []
  const subagentStarts = []
  const agentStatuses = []
  ctx.on('subagent/start', (info) => subagentStarts.push({ id: String(info.id), parent: String(info.parentSessionId), provider: info.provider, at: now() }))
  ctx.on('subagent/end', (info) => subagentEnds.push({ id: String(info.id), parent: String(info.parentSessionId), stopReason: info.stopReason, at: now() }))
  ctx.on('agent/status', ({ agent, status }) => agentStatuses.push({ id: String(agent.id), status, at: now() }))

  const tasks = ctx.get('tasks')
  const agents = ctx.get('agents')
  const subagents = ctx.get('subagents')
  const persistence = ctx.get('sessionPersistence')
  // 观测面：包一层真实 waitForTreeWork，记录每次调用的 root/返回值/耗时/是否来自 harness。
  // 不改变语义：wrapper 原样调用并返回真实实现。tasks 的 `untilQuiet` 也会调它，
  // 因此 fromHarness=false 且耗时≈子代理完成时间的调用即 executor 等待整棵树的证据。
  const waitCalls = []
  const realWaitForTreeWork = subagents.waitForTreeWork.bind(subagents)
  subagents.waitForTreeWork = async (root) => {
    const started = Date.now()
    // 调用点判别：tasks 的 `untilQuiet` 在 background.ts 内调用；harness 在 index.js 内调用。
    const stack = (new Error().stack ?? '').split('\n').slice(1, 8).join(' | ')
    const fromExecutor = stack.includes('executor/background.ts')
    let value
    try { value = await realWaitForTreeWork(root); return value }
    finally { waitCalls.push({ root: String(root.id), fromExecutor, value, waitedMs: Date.now() - started, at: now(), stack }) }
  }
  const copy = tasks.settingsFace.read()
  report.environment.realm = tasks.realm
  report.environment.masterId = tasks.masterId
  report.environment.boot = tasks.boot
  report.environment.healthAtStart = tasks.health()

  // ── 1. 名单：webchat 来源允许本 realm（否则 Trigger 落到 filtered，不进 Eval）──
  const settings = JSON.parse(JSON.stringify(copy.settings))
  settings.policy = settings.policy ?? { rules: [], sources: {} }
  settings.policy.sources = settings.policy.sources ?? {}
  settings.policy.sources.webchat = {
    ...(settings.policy.sources.webchat ?? {}),
    allowed: [{ id: tasks.realm, name: 'api-harness' }],
  }
  const save = tasks.settingsFace.save('policy', settings, copy.revisions.policy)
  report.checks.policyAllowed = { ok: save.ok === true, saved: save.saved, revision: save.revision }
  log('policy save', report.checks.policyAllowed)

  const master = await waitFor(() => agents.get(tasks.masterId), 30_000, 'master agent')
  report.statuses.master = statusOf(master)

  const { normalizeWebchatTrigger } = await import('/repo/packages/tasks/src/sources/webchat.ts')
  const delegation = {
    objective: '执行一条短任务并报告结果',
    outputFormat: '一句 REPORT 文本',
    toolGuidance: '可用宿主的 bash 工具；不需要改文件',
    taskBoundaries: '只做本条消息描述的事，不扩展',
  }
  const texts = [
    '用 bash 工具运行 `sleep 45` 并等待它结束，然后回复 REPORT: worker-a done。不要做别的事。',
    '用 bash 工具运行 `sleep 45` 并等待它结束，然后回复 REPORT: worker-b done。不要做别的事。',
  ]
  const tickets = []
  for (let i = 0; i < texts.length; i += 1) {
    const trigger = normalizeWebchatTrigger({
      sessionId: tasks.masterId,
      messageId: `api-harness-msg-${i + 1}`,
      text: texts[i],
      at: now(),
      actor: { source: 'webchat', id: tasks.realm },
    })
    // 同一主会话的后续消息在产品里会并入既有工单线程（follow-up），因此两条并发工单
    // 用主会话的两个独立线程标识（会话归属 meta.sessionId 仍是主会话，scope/gate 不变）。
    const thread = { source: 'webchat', id: `${tasks.masterId}::api-batch-${i + 1}` }
    trigger.threads = [thread]
    trigger.channel = { ...(trigger.channel ?? {}), thread: `webchat:${thread.id}` }
    const received = tasks.engine.receive(trigger)
    tasks.pass()
    const candidate = await waitFor(() => tasks.engine.candidate(trigger.id), 30_000, `candidate ${i + 1}`)
    tasks.engine.candidateDelivered(candidate.evalId)
    const decision = tasks.engine.decide(trigger.id, {
      kind: 'accept',
      title: i === 0 ? 'API005 双 worker 验证 A' : 'API005 双 worker 验证 B',
      scope: '按消息原文执行该短任务。',
      reason: 'explicit harness request',
      acknowledgement: '好的，这就安排。',
      delegation,
    })
    report.dispatch.push({
      i: i + 1, triggerId: trigger.id, strength: candidate.strength, decisionKind: decision.kind, ticketId: decision.ticketId,
      reason: decision.reason,
    })
    log('dispatch', i + 1, received, candidate.strength, decision.kind, decision.ticketId)
    if (decision.kind === 'accept' && decision.ticketId) tickets.push(decision.ticketId)
    else throw new Error(`工单 ${i + 1} 未被 accept: ${JSON.stringify(decision)}`)
  }
  report.checks.twoTicketsAccepted = { ok: tickets.length === 2, tickets }

  // ── 2. 等两个真实 worker session 建出（DshExecutor + Sessions + sessionController）──
  const workers = []
  for (const ticketId of tickets) {
    const workerId = `worker-${ticketId}`
    const worker = await waitFor(() => agents.get(workerId), 60_000, `worker agent ${workerId}`)
    workers.push(worker)
    report.statuses[workerId] = statusOf(worker)
    log('worker ready', workerId, statusOf(worker))
  }
  report.checks.realWorkerSessions = {
    ok: workers.length === 2,
    workers: workers.map(worker => ({ id: String(worker.id), status: worker.status, cwd: worker.cwd ?? null })),
  }

  // 工单/assignment 领域态（只读 SQL 面，证明 worker 是真实 DshExecutor 跑出来的）
  report.tickets = tasks.query('select id, json_extract(value, \'$.title\') as title, json_extract(value, \'$.realm\') as realm from ticket order by id')
    .map(row => ({ id: row.id, title: row.title, realm: row.realm }))

  // ── 3. API-005/006：worker A 上两个真实子代理 ──────────────────────────────
  const workerA = workers[0]
  const childPrompt = (n) => [{ type: 'text', text: `不要调用任何工具。只回复这一行：DONE-${n}` }]
  const spawnA = []
  for (let n = 1; n <= 2; n += 1) {
    const activation = await withTimeout(subagents.startActivation({
      provider: 'spawn',
      label: `api-child-${n}`,
      name: `api-child-${n}`,
      prompt: childPrompt(n),
      parent: workerA,
      signal: new AbortController().signal,
      delivery: 'parent',
    }), 60_000, `startActivation child ${n}`)
    spawnA.push({ id: String(activation.childId), name: activation.name, messageId: String(activation.messageId ?? '') })
    log('spawned child', n, String(activation.childId), activation.name)
  }
  report.spawns.push({ worker: String(workerA.id), children: spawnA })

  // waitForTreeWork：在子代理都还在跑时调用；记录等待时长与返回。
  const joinStarted = Date.now()
  let joined
  try { joined = await withTimeout(subagents.waitForTreeWork(workerA), 240_000, 'waitForTreeWork(workerA)') }
  finally { /* no flag: call-site stack identifies the caller */ }
  const joinMs = Date.now() - joinStarted
  report.checks.waitForTreeWork = {
    ok: joined === true,
    returned: joined,
    waitedMs: joinMs,
    childrenStatusAfter: spawnA.map(child => ({ id: child.id, status: statusOf(agents.get(child.id)) })),
  }
  log('waitForTreeWork returned', joined, `${joinMs}ms`)

  // 回执：worker session 持久史里应有两条 subagent-settled（completed，sender=两个子代理）。
  const receipts = await waitFor(async () => {
    const events = await readHistory(persistence, workerA.session)
    const found = settlementReceipts(events)
    return found.length >= 2 ? found : false
  }, 180_000, 'worker A 双回执').catch(async (error) => {
    const events = await readHistory(persistence, workerA.session)
    report.errors.push(String(error))
    return settlementReceipts(events)
  })
  report.receipts.push({ worker: String(workerA.id), receipts })
  const expectedSenders = new Set(spawnA.map(child => child.id))
  report.checks.receipts = {
    ok: receipts.length === 2
      && receipts.every(receipt => receipt.stopReason === 'completed')
      && receipts.every(receipt => expectedSenders.has(receipt.sender))
      && new Set(receipts.map(receipt => receipt.sender)).size === 2,
    count: receipts.length,
    stopReasons: receipts.map(receipt => receipt.stopReason),
    senders: receipts.map(receipt => receipt.sender),
    expectedSenders: [...expectedSenders],
  }
  log('receipts', report.checks.receipts)

  // API-006：listDescendants 与派生树一致。
  const descA = await withTimeout(subagents.listDescendants(workerA.id), 30_000, 'listDescendants(workerA)')
  const descAIds = descA.map(entry => String(entry.id))
  report.descendants.workerA = {
    entries: descA.map(entry => ({ id: String(entry.id), parent: String(entry.parentId ?? ''), path: entry.path ?? null, depth: entry.depth ?? null, mode: entry.mode ?? null, diagnostic: entry.diagnostic ?? null })),
    ids: descAIds,
  }
  report.checks.executorTreeJoin = {
    ok: waitCalls.some(call => call.root === String(workerA.id) && call.fromExecutor === true
      && call.value === true && call.waitedMs >= 3_000),
    calls: waitCalls,
  }
  report.checks.listDescendants = {
    ok: descAIds.length === 2 && spawnA.every(child => descAIds.includes(child.id)),
    ids: descAIds,
    expected: spawnA.map(child => child.id),
  }
  log('listDescendants A', descAIds)

  // ── 4. API-007：worker B 派生一个长驻子代理，然后 drain ────────────────────
  const workerB = workers[1]
  const childB = await withTimeout(subagents.startActivation({
    provider: 'spawn',
    label: 'api-drain-child',
    name: 'api-drain-child',
    prompt: [{ type: 'text', text: '用 bash 工具运行 `sleep 120` 并等待它结束，然后回复 SLEPT。不要做别的事。' }],
    parent: workerB,
    signal: new AbortController().signal,
    delivery: 'parent',
  }), 60_000, 'startActivation child B')
  const childBId = String(childB.childId)
  report.spawns.push({ worker: String(workerB.id), children: [{ id: childBId, name: childB.name, messageId: String(childB.messageId ?? '') }] })
  const descBefore = await waitFor(async () => {
    const rows = await subagents.listDescendants(workerB.id)
    return rows.some(row => String(row.id) === childBId) ? rows : false
  }, 30_000, 'listDescendants(workerB) 可见 childB')
  report.descendants.workerBBefore = descBefore.map(entry => ({ id: String(entry.id), status: statusOf(agents.get(entry.id)) }))
  log('child B resident status', statusOf(agents.get(childBId)))

  const drainStarted = Date.now()
  await withTimeout(subagents.drainDescendants([workerB]), 60_000, 'drainDescendants(workerB)')
  const drainMs = Date.now() - drainStarted
  const descAfter = await withTimeout(subagents.listDescendants(workerB.id), 30_000, 'listDescendants(workerB) after drain')
  const residentAfter = descAfter.filter(entry => agents.get(entry.id) !== undefined).map(entry => String(entry.id))
  const treeWorkAfter = await withTimeout(subagents.waitForTreeWork(workerB), 60_000, 'waitForTreeWork(workerB) after drain')
  // drain 只释放后代；worker B 自己的回合（assignment）仍需收口。清理：取消并等 idle。
  if (workerB.status !== 'idle') workerB.cancel({ kind: 'user' }, { keepInbox: true })
  await withTimeout(workerB.whenIdle(), 30_000, 'workerB whenIdle')
  report.drain = {
    worker: String(workerB.id),
    drainedChild: childBId,
    drainMs,
    descendantsAfter: descAfter.map(entry => ({ id: String(entry.id), resident: agents.get(entry.id) !== undefined })),
    residentAfter,
    waitForTreeWorkAfter: treeWorkAfter,
    workerStatusAfter: workerB.status,
    subagentEnds: subagentEnds.filter(end => end.id === childBId || end.parent === String(workerB.id)),
  }
  report.checks.drainDescendants = {
    ok: residentAfter.length === 0 && treeWorkAfter === false && workerB.status === 'idle',
    residentAfter,
    waitForTreeWorkAfter: treeWorkAfter,
    workerStatusAfter: workerB.status,
  }
  log('drain B', report.checks.drainDescendants)

  // worker A 收到第二条回执后还会跑一个收尾回合；等它 idle 再取样，避免把
  // harness 主动退出时的 running 误读成残留。
  if (workerA.status !== 'idle') {
    await withTimeout(workerA.whenIdle(), 20_000, 'workerA whenIdle').catch((error) => {
      report.errors.push(String(error))
    })
  }

  report.statuses.after = {
    workerA: statusOf(workerA),
    workerB: statusOf(workerB),
    children: spawnA.map(child => ({ id: child.id, status: statusOf(agents.get(child.id)) })),
  }
  report.waitCalls = waitCalls
  report.checks.executorTreeJoin.calls = waitCalls
  report.subagentStarts = subagentStarts
  report.subagentEnds = subagentEnds
  report.agentStatusTransitions = agentStatuses
  report.healthAtEnd = tasks.health()
  report.finishedAt = now()
  report.ok = Object.values(report.checks).every(check => check.ok === true)
  return report
}

export function apply(ctx, config) {
  try {
    const llm = ctx.get('llm')
    llm.registerAdapter(['stub'], createStubAdapter())
  } catch (error) {
    console.error('[api-harness] stub adapter registration failed', error)
    process.exit(1)
  }
  run(ctx, config).then((report) => {
    const outDir = config?.outDir ?? '/tmp/api-run-home/out'
    writeFileSync(`${outDir}/results.json`, JSON.stringify(report, null, 2))
    writeFileSync(`${outDir}/harness.log`, lines.join('\n') + '\n')
    console.log('[api-harness] ok=', report.ok)
    process.exit(report.ok ? 0 : 2)
  }).catch((error) => {
    const outDir = config?.outDir ?? '/tmp/api-run-home/out'
    try {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(`${outDir}/results.json`, JSON.stringify({ ok: false, error: String(error?.stack ?? error), lines }, null, 2))
      writeFileSync(`${outDir}/harness.log`, lines.join('\n') + '\n')
    } catch {}
    console.error('[api-harness] FAILED', error)
    process.exit(1)
  })
}
