/**
 * 路由金集 → dsh-evals replay pack 适配层(G2-A9;53 号 §4-P1)。
 *
 * 数据源 = packages/tasks/tests/route-golden/entries.ts(判例唯一事实源,20 条,
 * GoldenKind 四类 accept/attach/ignore-bot/stop)。本脚本把它**生成式**包装为
 * dsh-evals 的 replay pack(`tools/evals` 的 pack 契约:evals/*.yaml 一文件一 case +
 * fixtures/<case-id>.jsonl 每行一个 DSH SessionEvent 形态事件),不提交静态 pack
 * ——判例落位 35 号 §12-10 未拍板(packages/tasks/tests/ vs dsh-evals pack),生成式
 * 保证判例增补后 pack 与数据源天然同步,不制造第二事实源。
 *
 * pack 产物契约(实测对齐 tools/evals/src/schema.ts 与 packs/event-planning 真例):
 * - case id 判例映射:`RG-01` → `rg-01`(dsh-evals CASE_ID_RE 要求 `[a-z0-9][a-z0-9_-]*`,
 *   全小写;fixtures 文件名同步 `rg-01.jsonl`);
 * - YAML 字符串值一律 JSON.stringify 双引号标量(JSON 双引号字符串是合法 YAML 1.2
 *   标量,规避触发原文里的冒号/`#`/引号破坏 plain scalar;零第三方依赖);
 * - fixture 事件形态对照 packs/event-planning/fixtures 真例:turn/start、user/message
 *   (data.message.content)、assistant/message(data.message.content + usage);
 * - 断言面(answer.contains)= `route=<kind>`:衰减度量的判据是**裁决类别一致性**
 *   (accept 还 accept、attach 还 attach…),title/reason 是模型自由文本,压缩态重放
 *   时不可能逐字复现,不进断言面;完整记录裁决文本仍写入 fixture 的 assistant/message
 *   与 YAML description,供人工复盘。
 *
 * 判例前置(setup 种子工单/名单/bots 扩展)分两面登记:
 * - 会话事件面:种子 trigger 原文与其裁决(route=accept——setup 语义即「开出对象工单」),
 *   以 fixture user/message + assistant/message 前置;
 * - 宿主配置面:名单/bots 扩展、种子是否已结束(ready)、bot actor 与 byGate 等宿主
 *   运行态不是会话事件,以 fixture 事件 data.routeMeta 附带登记(JSON 扩展键,dsh-evals
 *   fixture 解析只读 type/seq/time、data 透传,见 src/adapters/replay.ts),供压缩态
 *   重放器重建宿主运行态消费;YAML description 同步登记 why 与记录裁决供人读。
 *
 * 「在压缩后的会话状态上回放」需真实会话态(DSH 会话 + 压缩后 context + 重放器把
 * fixture 换成压缩态真实裁决流),离线不可跑——本脚本 + dsh-evals replay 真跑构成
 * 「适配层 + 离线可跑的形态校验」;压缩态半边登记见 tests/route-golden/README.md。
 *
 * 用法:
 *   node scripts/route-golden-pack.mjs [--out <目录>]
 * 默认产物目录 = <repo>/dsh-evals-out/route-golden-pack(该目录已 gitignore)。
 * 幂等:整目录重建(先清后写),与 packs/event-planning/evals/gen-replay-fixtures.mjs
 * 同纪律。
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ENTRIES_FILE = join(REPO_ROOT, 'packages/tasks/tests/route-golden/entries.ts')
const DEFAULT_OUT = join(REPO_ROOT, 'dsh-evals-out/route-golden-pack')

/** dsh-evals 的 golden case id 约定(tools/evals/src/schema.ts CASE_ID_RE):全小写。 */
const caseIdOf = entry => entry.id.toLowerCase()

/**
 * 记录面裁决文本:判例 replay(记录的模型裁决,Decision 面)的规范化投影。
 * 断言面只取前缀 `route=<kind>`(见文件头);`byGate=true` 表示策略门结构性裁定
 * (路由器未见候选,如名单外 bot)。
 */
function decisionTextOf(replay) {
  const parts = [`route=${replay.kind}`]
  if (replay.kind === 'accept') {
    parts.push(`title=${replay.title}`)
    parts.push(`scope=${replay.scope}`)
    parts.push(`reason=${replay.reason}`)
  } else if (replay.kind === 'attach') {
    if (replay.note !== undefined) parts.push(`note=${replay.note}`)
  } else {
    parts.push(`reason=${replay.reason}`)
  }
  if (replay.byGate === true) parts.push('byGate=true')
  return parts.join('; ')
}

/** YAML 双引号标量(JSON.stringify 产物是合法 YAML 1.2 双引号标量,零依赖安全法)。 */
const ystr = value => JSON.stringify(value)

/**
 * 单判例 → golden case YAML 文本。
 * tags 前两位固定 [route-golden, <kind>],--subset route-golden 可跑全集、
 * --subset <kind> 可按四类分片跑(与 28 §5 四类口径对齐)。
 */
function goldenYamlOf(entry) {
  const lines = [
    `# 路由金集 ${entry.id}(生成于 scripts/route-golden-pack.mjs,勿手改;数据源 entries.ts)`,
    `id: ${caseIdOf(entry)}`,
    `description: ${ystr(`[${entry.kind}] ${entry.why} 记录裁决=${decisionTextOf(entry.replay)}`)}`,
    `user_input: ${ystr(entry.trigger.text)}`,
    `tags: [${ystr('route-golden')}, ${ystr(entry.kind)}]`,
    `answer:`,
    `  contains: ${ystr(`route=${entry.replay.kind}`)}`,
  ]
  return `${lines.join('\n')}\n`
}

/** 一行一个 JSON 的 SessionEvent 事件(对照 packs/event-planning/fixtures 真例形态)。 */
const eventLine = (seq, time, type, data) => JSON.stringify({ type, seq, time, data })

/** user/message:真实 surface 形态为 data.message.content(events.ts messageTextOf 双容忍)。 */
const userMessage = (seq, time, text, routeMeta) => eventLine(seq, time, 'user/message', {
  message: { role: 'user', content: [{ type: 'text', text }] },
  ...(routeMeta === undefined ? {} : { routeMeta }),
})

/** assistant/message:文本块 + usage(token 计数,预算/指标面口径)。 */
const assistantMessage = (seq, time, turn, step, text) => eventLine(seq, time, 'assistant/message', {
  turn,
  step,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  stream: [],
  usage: { inputTokens: 0, outputTokens: 0 },
})

/**
 * 单判例 → fixture jsonl 文本(DSH SessionEvent 每行一个)。
 *
 * 形态校验的回放语义:会话里先(有种子时)记录种子 trigger 与其裁决,随后判例
 * trigger 到达,末条 assistant/message 即记录的路由裁决——replay 适配器回放该流,
 * answer.contains=route=<kind> 断言「记录裁决类别与判例一致」。判例语义上下文
 * (human/actor/bot/名单扩展/byGate)以 data.routeMeta 附带,供压缩态重放器重建
 * 宿主运行态消费(该半边见文件头与 README)。
 */
function fixtureOf(entry) {
  const lines = []
  let seq = 1
  const t0 = 1762000000000
  // 判例前置:种子工单的触发原文与裁决(setup.id/text 为 attach/stop 判例必填,
  // 形态由 tests/route-golden.spec.ts 钉住)。ready(已结束)归宿主运行态,在
  // routeMeta.seed 登记,不伪造已结束的会话事件。
  if (entry.setup?.id !== undefined && entry.setup?.text !== undefined) {
    lines.push(userMessage(seq, t0 + seq, entry.setup.text, {
      role: 'seed',
      seedId: entry.setup.id,
      ready: entry.setup.ready === true,
    }))
    seq += 1
    lines.push(assistantMessage(seq, t0 + seq, 1, 1, 'route=accept'))
    seq += 1
  }
  // 判例 trigger(触发原文 = 压缩强制保留项,逐字进 user/message)。
  const meta = { role: 'case', kind: entry.kind, human: entry.trigger.human !== false }
  if (entry.trigger.human === false) {
    meta.bot = entry.trigger.bot ?? `bot-${entry.trigger.id}`
    meta.actor = { source: 'test', id: meta.bot }
  } else if (entry.trigger.actor !== undefined) {
    meta.actor = { source: 'test', id: entry.trigger.actor }
  }
  if (entry.trigger.addressed !== undefined) meta.addressed = entry.trigger.addressed
  if (entry.setup?.allowed?.length) meta.allowed = entry.setup.allowed
  if (entry.setup?.bots?.length) meta.registerBots = entry.setup.bots
  if (entry.replay.byGate === true) meta.byGate = true
  lines.push(eventLine(seq, t0 + seq, 'turn/start', { turn: 1 }))
  seq += 1
  lines.push(userMessage(seq, t0 + seq, entry.trigger.text, meta))
  seq += 1
  lines.push(assistantMessage(seq, t0 + seq, 1, 2, decisionTextOf(entry.replay)))
  return `${lines.join('\n')}\n`
}

/** 清空重建产物目录(幂等;只清 route-golden 自有产物,不碰 dsh-evals-out 其他 run)。 */
function resetPackDir(outDir) {
  if (existsSync(outDir)) {
    for (const name of readdirSync(outDir)) {
      rmSync(join(outDir, name), { recursive: true, force: true })
    }
  } else {
    mkdirSync(outDir, { recursive: true })
  }
}

/** 生成 pack;返回 { outDir, count }。 */
export async function generatePack(outDir = DEFAULT_OUT, entries = null) {
  // 数据源 entries.ts:node 24 原生 type-stripping 直接 import TS 源
  // (与 tools/evals/bin/dsh-evals.mjs 消费 src/cli.ts 同款;engines node>=22.6)。
  const module = await import(ENTRIES_FILE)
  const golden = entries ?? module.ROUTING_GOLDEN
  if (!Array.isArray(golden) || golden.length === 0) {
    throw new Error(`判例数据源为空或形态不符: ${ENTRIES_FILE}`)
  }
  const ids = new Set()
  for (const entry of golden) {
    if (ids.has(entry.id)) throw new Error(`判例 id 重复: ${entry.id}`)
    ids.add(entry.id)
  }
  resetPackDir(outDir)
  mkdirSync(join(outDir, 'evals'), { recursive: true })
  mkdirSync(join(outDir, 'fixtures'), { recursive: true })
  for (const entry of golden) {
    const id = caseIdOf(entry)
    writeFileSync(join(outDir, 'evals', `${id}.yaml`), goldenYamlOf(entry), 'utf8')
    writeFileSync(join(outDir, 'fixtures', `${id}.jsonl`), fixtureOf(entry), 'utf8')
  }
  return { outDir, count: golden.length }
}

// ---- CLI ----

export async function main(argv) {
  let outDir = DEFAULT_OUT
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--out') {
      const value = argv[index + 1]
      if (value === undefined) return usage()
      outDir = resolve(value)
      index += 1
    } else if (token?.startsWith('--out=')) {
      outDir = resolve(token.slice('--out='.length))
    } else if (token === '--help' || token === '-h') {
      return usage()
    } else {
      process.stderr.write(`未知参数: ${token}\n`)
      return usage()
    }
  }
  try {
    const { outDir: used, count } = await generatePack(outDir)
    process.stdout.write(`route-golden pack: ${used} cases=${count} evals=${count} fixtures=${count}\n`)
    process.stdout.write(`跑法: node tools/evals/bin/dsh-evals.mjs run --pack ${used} --adapter replay\n`)
    return 0
  } catch (cause) {
    process.stderr.write(`生成失败: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    return 2
  }
}

function usage() {
  process.stderr.write([
    '用法: node scripts/route-golden-pack.mjs [--out <目录>]',
    '',
    '数据源 = packages/tasks/tests/route-golden/entries.ts(20 条路由判例)。',
    '产物 = dsh-evals replay pack(evals/*.yaml + fixtures/*.jsonl),幂等覆盖。',
    '默认产物目录 = dsh-evals-out/route-golden-pack(gitignored)。',
    '',
  ].join('\n'))
  return 2
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main(process.argv.slice(2)).then(code => process.exit(code))
}
