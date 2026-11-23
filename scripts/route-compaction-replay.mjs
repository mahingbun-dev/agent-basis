/**
 * 路由金集压缩态回放驱动(G2-A9 收口;53 号 §4-P1 遗留;28 号 §5 口径)。
 *
 * 此前 nightly 的「第二遍」是同口径 replay 复跑,差值恒 0 by construction(形似恒真
 * 断言)。本驱动补上真腿:同一金集、同一模型,干净态(完整会话历史)与压缩态(历史经
 * LLM 压缩为摘要)各路由一遍,判据 = 判例的记录裁决(entry.kind),两腿通过率差
 * ≤ threshold(默认 2 个百分点,28 §5)判无衰减。产物 JSONL 与 scripts/diff-pass-rate.mjs
 * 的输入契约同形({case_id,status}),入库 markdown 报告供评审。
 *
 * 判据与保真边界(诚实登记):
 * - 触发原文逐字进候选卡,两腿同文(21 号 D3 定制品:触发原文 = 压缩强制保留项);
 *   压缩只作用于「会话历史」半边——这正是压缩衰减的作用面(路由器丢的是历史记忆,
 *   不是候选卡);
 * - v0 的会话历史 = 从判例字段(setup 种子)确定性派生的合成转录(种子受理→worker
 *   ready),不含凭空事实;真实 audit trace 历史的灌入随 24a C4 月度增补扩展
 *   (buildHistoryText 是唯一替换点);
 * - byGate 判例(策略门结构性裁定,路由器未见候选)不进双腿度量,单列登记;
 * - 凭据只在运行时读 <repoRoot>/.secrets/litellm-*(gitignored),不写日志/报告/argv。
 *
 * 用法:
 *   node scripts/route-compaction-replay.mjs [--model deepseek-flash] [--threshold 2]
 *     [--out <目录>] [--limit <n>] [--dry-run]
 * 默认产物目录 = <repo>/dsh-evals-out/route-compaction(该目录已 gitignore)。
 * 退出码:0 = 无衰减(差 ≤ threshold);1 = 衰减超标;2 = 用法/环境错误(缺凭据等)。
 * CI nightly 的 replay 腿保持保活(无凭据面);本驱动在有凭据环境跑真腿,两腿产物
 * 可直接喂 diff-pass-rate.mjs 互证。
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ENTRIES_FILE = join(REPO_ROOT, 'packages/tasks/tests/route-golden/entries.ts')
const DEFAULT_OUT = join(REPO_ROOT, 'dsh-evals-out/route-compaction')
const DEFAULT_MODEL = 'deepseek-flash'
const DEFAULT_THRESHOLD = 2
/** 单次 LLM 调用超时与网络错误重试(瞬时 5xx/网络抖动;非幂等错误不重试)。 */
const CALL_TIMEOUT_MS = 120_000
const CALL_RETRIES = 1

/** GoldenKind 四类(与 entries.ts GoldenKind 同形;校验模型输出的裁决词)。 */
const GOLDEN_KINDS = ['accept', 'attach', 'ignore-bot', 'stop']

// ── 凭据(运行时读;不落日志/报告/argv)─────────────────────────────────────────

/** 读 .secrets/litellm-*(env 覆盖优先);缺文件即抛(调用方转退出码 2)。 */
export function loadGatewayConfig(env = process.env) {
  const baseUrl = env.LITELLM_BASE_URL ?? readSecret('litellm-base-url.txt')
  const apiKey = env.LITELLM_MASTER_KEY ?? readSecret('litellm-master-key.txt')
  if (!baseUrl || !apiKey) throw new Error('.secrets/litellm-base-url.txt 与 litellm-master-key.txt 必须成组在位(env LITELLM_BASE_URL/LITELLM_MASTER_KEY 可覆盖)')
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
}

function readSecret(name) {
  const path = join(REPO_ROOT, '.secrets', name)
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8').trim()
}

// ── LLM 直连(OpenAI 兼容 /chat/completions,非流式)────────────────────────────

/** 一次补全调用;返回 {text, elapsedMs}。网络错误/5xx 重试 CALL_RETRIES 次。 */
export async function callLlm(gateway, { system, user, model, maxTokens = 2048, timeoutMs = CALL_TIMEOUT_MS }) {
  let lastError
  for (let attempt = 0; attempt <= CALL_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()
    try {
      const response = await fetch(`${gateway.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${gateway.apiKey}` },
        body: JSON.stringify({
          model, max_tokens: maxTokens, temperature: 0,
          messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.length === 0) throw new Error('空补全')
      return { text, elapsedMs: Date.now() - startedAt }
    } catch (error) {
      lastError = error
      // 空补全按瞬时处理:推理型档位(reasoning 消耗 max_tokens)偶发 content 为空。
      const statusLike = error instanceof Error && /\bHTTP 5\d\d\b/.test(error.message)
      const networkLike = error instanceof Error && (error.name === 'AbortError' || /\bfetch failed\b/i.test(error.message))
      const emptyLike = error instanceof Error && error.message === '空补全'
      if (!(statusLike || networkLike || emptyLike) || attempt === CALL_RETRIES) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`LLM 调用失败:${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

// ── 纯函数:提示词构建 / 裁决解析 / 评分(测试面)───────────────────────────────

/** 会话历史合成转录(v0:仅从判例 setup 种子派生;audit trace 灌入见文件头)。 */
export function buildHistoryText(entry) {
  const seed = entry.setup
  if (seed === undefined || typeof seed.id !== 'string' || typeof seed.text !== 'string') {
    return '（此前会话无活跃工单与未决事项。）'
  }
  const lines = [
    `人消息(trigger ${seed.id},名单内发送者):「${seed.text}」`,
    `→ 路由裁决:受理为工单 ${seed.id}。`,
  ]
  lines.push(seed.ready === true
    ? `→ worker 汇报 ready:工单 ${seed.id} 已完成结束。`
    : `→ 工单 ${seed.id} 进行中(worker 执行中)。`)
  return lines.join('\n')
}

/** 压缩指令:只压历史半边;工单 id/触发原文/状态与未决事项逐字保留(D3 同纪律)。 */
export function buildCompactionPrompt(history) {
  return [
    '你是任务主会话的会话压缩器。把下面的会话历史压缩为一份摘要,供后续路由裁决使用。',
    '强制保留(逐字,不得改写):所有工单 id、人的消息原文(引号内文字)、工单状态与未决问题。',
    '可以合并与丢弃:过程性叙述、重复表述、与工单状态无关的寒暄。',
    '直接输出摘要正文(≤300 字),不要任何前后缀说明。',
    '',
    '[会话历史]',
    history,
  ].join('\n')
}

/** 路由提示词(dispatch 决策面的最小投影):history 参数两腿分别传原文/压缩摘要。 */
export function buildRoutingPrompt({ entry, history }) {
  const trigger = entry.trigger
  const seed = entry.setup
  const roster = ['u-alice', ...(seed?.allowed ?? [])]
  const bots = seed?.bots ?? []
  const actor = trigger.actor ?? 'u-alice'
  const human = trigger.human !== false
  const addressed = trigger.addressed ?? (human ? true : false)
  return [
    '你是任务主会话(orchestrator)的路由器。依据下面的会话状态与候选卡,对候选做一次裁决:',
    'accept(受理,开工单)/ attach(挂到已有工单)/ ignore-bot(忽略 bot 消息)/ stop(停止既有工单)。',
    '',
    '[环境]',
    `名单内发送者:${roster.join('、')}。`,
    bots.length > 0 ? `已登记 bots(其消息不对准、默认忽略):${bots.join('、')}。` : '已登记 bots:无。',
    '',
    '[会话历史]',
    history,
    '',
    '[候选卡]',
    `触发原文(逐字):「${trigger.text}」`,
    `发送者:${actor}${human ? '' : `(bot)`};对准 agent:${addressed ? '是' : '否'}。`,
    seed?.id !== undefined ? `相关工单(Engine 计算):${seed.id}(${seed.ready === true ? '已结束' : '进行中'})。` : '相关工单(Engine 计算):无。',
    '',
    '只依据以上信息裁决。回复最后一行必须是:route=accept、route=attach、route=ignore-bot、route=stop 之一。',
  ].join('\n')
}

/** 从模型回复解析裁决词:取最后一个 route=<kind> 行;解析不出返回 undefined。 */
export function parseVerdict(text) {
  const matches = [...String(text).matchAll(/route\s*=\s*(accept|attach|ignore-bot|stop)\b/gi)]
  if (matches.length === 0) return undefined
  return matches[matches.length - 1][1].toLowerCase()
}

/** 单条判例双腿判定:pass 当两腿解析出的裁决都等于记录裁决(entry.kind)。 */
export function judgeEntry(entry, cleanText, compactedText) {
  const clean = parseVerdict(cleanText)
  const compacted = parseVerdict(compactedText)
  return { clean, compacted, cleanPass: clean === entry.kind, compactedPass: compacted === entry.kind }
}

/** 退出码裁决:|压缩态通过率 − 干净态通过率| ≤ threshold(百分点)⇒ 0;超标 ⇒ 1。
 * 浮点容差 1e-9:0.97−0.95 这类边界差在 IEEE754 下会多出 ~2e-15,不作容差会把「相等」误判超标。 */
export function decideExit(cleanRate, compactedRate, threshold = DEFAULT_THRESHOLD) {
  const diffPp = Math.abs(compactedRate - cleanRate) * 100
  return diffPp <= threshold + 1e-9 ? 0 : 1
}

// ── 驱动主流程(llm 可注入;生产面传真实 gateway)──────────────────────────────

/**
 * 跑双腿:顺序逐条(确定性,不做并发)。返回 {cleanLines, compactedLines, report, rates}。
 * @param llm - (prompt: string) => Promise<string> 的补全面;system/user 由内部拼装后整包传入。
 */
export async function runRouteCompaction({ entries, llm, model = DEFAULT_MODEL, threshold = DEFAULT_THRESHOLD, log = () => {} }) {
  const live = entries.filter(entry => entry.replay?.byGate !== true)
  const gated = entries.filter(entry => entry.replay?.byGate === true)
  log(`判例 ${entries.length} 条;进双腿 ${live.length} 条(byGate 结构性裁定 ${gated.length} 条单列)`)
  const cleanLines = []
  const compactedLines = []
  const details = []
  for (const entry of live) {
    const history = buildHistoryText(entry)
    const routingClean = buildRoutingPrompt({ entry, history })
    const cleanText = await llm(routingClean)
    const digest = await llm(buildCompactionPrompt(history))
    const routingCompacted = buildRoutingPrompt({ entry, history: digest })
    const compactedText = await llm(routingCompacted)
    const verdict = judgeEntry(entry, cleanText, compactedText)
    cleanLines.push({ case_id: entry.id.toLowerCase(), status: verdict.cleanPass ? 'pass' : 'fail' })
    compactedLines.push({ case_id: entry.id.toLowerCase(), status: verdict.compactedPass ? 'pass' : 'fail' })
    details.push({ id: entry.id, kind: entry.kind, ...verdict,
      cleanText: cleanText.slice(0, 400), compactedText: compactedText.slice(0, 400), digest: digest.slice(0, 600) })
    log(`${entry.id}(${entry.kind}):clean=${verdict.clean ?? '∅'} compacted=${verdict.compacted ?? '∅'}`)
  }
  const rate = lines => lines.length === 0 ? 1 : lines.filter(line => line.status === 'pass').length / lines.length
  const rates = { clean: rate(cleanLines), compacted: rate(compactedLines) }
  const exit = decideExit(rates.clean, rates.compacted, threshold)
  const report = { model, threshold, generatedAt: new Date().toISOString(),
    total: entries.length, live: live.length, gated: gated.map(entry => entry.id),
    rates, exit, details,
    note: 'v0 会话历史为判例字段确定性派生的合成转录;真实 audit trace 灌入随 24a C4 扩展(见脚本文件头)。' }
  return { cleanLines, compactedLines, report, rates, exit }
}

/** 入库 markdown 报告(不含任何凭据;digest 只取首两条样例防报告膨胀)。 */
export function renderReportMd(report) {
  const pct = rate => `${(rate * 100).toFixed(1)}%`
  const diffPp = Math.abs(report.rates.compacted - report.rates.clean) * 100
  const lines = [
    `# 路由金集压缩态回放报告(G2-A9;28 号 §5)`,
    '',
    `- 生成:${report.generatedAt};模型:${report.model};阈值:${report.threshold}pp`,
    `- 判例:${report.total} 条(双腿 ${report.live} + byGate 单列 ${report.gated.length}${report.gated.length > 0 ? `:${report.gated.join('、')}` : ''})`,
    `- 干净态通过率:${pct(report.rates.clean)};压缩态通过率:${pct(report.rates.compacted)};差值:${diffPp.toFixed(1)}pp`,
    `- 结论:${report.exit === 0 ? '无衰减(≤阈值)' : '衰减超标(>阈值,按 28 §5 调摘要档位或保留策略,不允许改 prompt 纪律硬扛)'}`,
    '',
    '## 逐条裁决',
    '',
    '| 判例 | 记录 | 干净态 | 压缩态 |',
    '|---|---|---|---|',
    ...report.details.map(d => `| ${d.id} | ${d.kind} | ${d.clean ?? '∅'}${d.cleanPass ? '' : ' ✗'} | ${d.compacted ?? '∅'}${d.compactedPass ? '' : ' ✗'} |`),
    '',
    '## 压缩摘要样例(前 2 条)',
    '',
    ...report.details.slice(0, 2).flatMap(d => [`### ${d.id}`, '', d.digest, '']),
    '## 边界登记',
    '',
    report.note,
  ]
  return lines.join('\n')
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function argValue(flag, args) {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}

export async function main(argv = process.argv.slice(2)) {
  const outDir = resolve(REPO_ROOT, argValue('--out', argv) ?? DEFAULT_OUT)
  const model = argValue('--model', argv) ?? DEFAULT_MODEL
  const threshold = Number(argValue('--threshold', argv) ?? DEFAULT_THRESHOLD)
  const limit = Number(argValue('--limit', argv) ?? Number.POSITIVE_INFINITY)
  const dryRun = argv.includes('--dry-run')
  if (!Number.isFinite(threshold) || threshold < 0) {
    console.error('--threshold 必须是非负数'); return 2
  }
  const { ROUTING_GOLDEN } = await import(ENTRIES_FILE)
  const entries = ROUTING_GOLDEN.slice(0, Number.isFinite(limit) ? limit : undefined)
  if (dryRun) {
    for (const entry of entries) console.log(`${entry.id}(${entry.kind})${entry.replay?.byGate === true ? ' byGate' : ''}`)
    return 0
  }
  let gateway
  try {
    gateway = loadGatewayConfig()
  } catch (error) {
    console.error(String(error.message ?? error)); return 2
  }
  const llm = async prompt => (await callLlm(gateway, { system: undefined, user: prompt, model })).text
  const outcome = await runRouteCompaction({ entries, llm, model, threshold, log: message => console.log(message) })
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'route-compaction-baseline.jsonl'),
    outcome.cleanLines.map(line => JSON.stringify(line)).join('\n') + '\n')
  writeFileSync(join(outDir, 'route-compaction-compacted.jsonl'),
    outcome.compactedLines.map(line => JSON.stringify(line)).join('\n') + '\n')
  // diff-pass-rate.mjs 的目录契约(sessions.jsonl)同步落一份,直喂即用。
  for (const [name, lines] of [['route-compaction-baseline', outcome.cleanLines], ['route-compaction-compacted', outcome.compactedLines]]) {
    mkdirSync(join(outDir, name), { recursive: true })
    writeFileSync(join(outDir, name, 'sessions.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n')
  }
  writeFileSync(join(outDir, 'route-compaction-report.json'), JSON.stringify(outcome.report, null, 1))
  writeFileSync(join(outDir, 'route-compaction-report.md'), renderReportMd(outcome.report))
  console.log(`产物:${outDir}(baseline/compacted JSONL + report.json/md;可直喂 scripts/diff-pass-rate.mjs)`)
  console.log(`干净态 ${(outcome.rates.clean * 100).toFixed(1)}% vs 压缩态 ${(outcome.rates.compacted * 100).toFixed(1)}%,exit=${outcome.exit}`)
  return outcome.exit
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code)).catch(error => {
    console.error(`执行失败:${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
