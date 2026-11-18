/**
 * 本地审计面(`$DSH_HOME/knowledge-admin/knowledge-audit.jsonl`)。
 *
 * 双写纪律:
 * - **远端**:`ctx.get('audit')?.report({ action, detail, actor })` fire-and-forget,
 *   全包 try/catch(服务缺席/抛错一律静默——审计不能挡住业务动作,也不能把异常变成业务失败);
 * - **本地**:一行一条 JSON 追加(sanitize 后写:只留白名单字段、截断长串、抹掉疑似令牌片段),
 *   含 `account / actor / action / outcome / ts / detail`;
 * - 读面 `readAudit` 按账号 + 时间窗 + 动作前缀过滤,分页返回。
 *
 * 红线:任何写进审计的内容都不得含凭据;{@link sanitizeAuditDetail} 在写入前按
 * "看起来像令牌"的片段做掩码(本包本身从不把令牌放进审计入参,这是纵深防御)。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import type { KnowledgeAdminAuditEntry } from './types.ts'

/** 远端审计服务的最小结构子集(缺席即静默)。 */
export interface AuditServiceLike {
  report?(entry: { readonly action: string; readonly detail: unknown; readonly actor: unknown }): unknown
}

/** detail 长度上限(超长截断,防审计文件无界膨胀)。 */
const DETAIL_MAX = 200
/** 疑似令牌片段掩码(纵深防御;本包绝不主动写令牌)。 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[0-9A-Z._~+\/=\-]{8,}/gi,
  /[A-Za-z0-9+/=_-]{40,}/g,
  /(?:token|secret|password|apikey|api_key)[=:]\s*[^\s,;&]+/gi,
]

/** 抹掉疑似凭据片段(只作用于出站审计文本)。 */
export function sanitizeAuditDetail(raw: string): string {
  let out = raw
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]')
  out = out.replace(/\s+/g, ' ').trim()
  return out.length > DETAIL_MAX ? `${out.slice(0, DETAIL_MAX)}…` : out
}

/** 审计写入面(append-only;目录自己 ensure)。 */
export class KnowledgeAuditLog {
  readonly #filePath: string
  readonly #dir: string
  readonly #now: () => Date
  #ensured = false

  constructor(filePath: string, now: () => Date = () => new Date()) {
    this.#filePath = filePath
    this.#dir = filePath.slice(0, Math.max(0, filePath.lastIndexOf('/')))
    this.#now = now
  }

  get path(): string {
    return this.#filePath
  }

  /**
   * 追加一条(同步语义:调用方 await;写失败抛给调用方,**由调用方决定不拖垮业务**——
   * 本类不吞错,吞错必须在可见处发生)。
   */
  async append(entry: {
    readonly account: string
    readonly actor: string
    readonly action: string
    readonly outcome: 'ok' | 'error' | 'forbidden'
    readonly detail?: string | undefined
  }): Promise<KnowledgeAdminAuditEntry> {
    const record: KnowledgeAdminAuditEntry = {
      ts: this.#now().toISOString(),
      account: entry.account,
      actor: entry.actor,
      action: entry.action,
      outcome: entry.outcome,
      ...(entry.detail === undefined ? {} : { detail: sanitizeAuditDetail(entry.detail) }),
    }
    if (!this.#ensured) {
      await mkdir(this.#dir, { recursive: true })
      this.#ensured = true
    }
    await appendFile(this.#filePath, `${JSON.stringify(record)}\n`, 'utf8')
    return record
  }

  /**
   * 读面:按过滤条件返回全部匹配条目(排序=写入序,即时间升序)。
   * 文件缺席 → 空集(不是错误:新部署第一次审计前就是这样)。
   * 坏行(手工改坏/写中断)→ 跳过该行(不整体失败)。
   */
  async read(filter: {
    readonly account?: string | undefined
    readonly since?: string | undefined
    readonly until?: string | undefined
    readonly action?: string | undefined
  } = {}): Promise<readonly KnowledgeAdminAuditEntry[]> {
    let text: string
    try {
      text = await readFile(this.#filePath, 'utf8')
    } catch {
      return []
    }
    const since = parseTime(filter.since)
    const until = parseTime(filter.until)
    const out: KnowledgeAdminAuditEntry[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }
      const entry = asEntry(parsed)
      if (entry === undefined) continue
      if (filter.account !== undefined && filter.account !== '*' && entry.account !== filter.account) continue
      if (filter.action !== undefined && filter.action.length > 0 && !entry.action.startsWith(filter.action)) continue
      const at = parseTime(entry.ts)
      if (since !== undefined && (at === undefined || at < since)) continue
      if (until !== undefined && (at === undefined || at > until)) continue
      out.push(entry)
    }
    return out
  }
}

/** ISO → ms(非法/缺省 → undefined;用于过滤时不排除"解析不了的时间戳")。 */
export function parseTime(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function asEntry(value: unknown): KnowledgeAdminAuditEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const ts = row.ts
  const account = row.account
  const actor = row.actor
  const action = row.action
  const outcome = row.outcome
  const detail = row.detail
  if (typeof ts !== 'string' || typeof account !== 'string' || typeof actor !== 'string' || typeof action !== 'string') {
    return undefined
  }
  if (outcome !== 'ok' && outcome !== 'error' && outcome !== 'forbidden') return undefined
  return {
    ts,
    account,
    actor,
    action,
    outcome,
    ...(typeof detail === 'string' ? { detail } : {}),
  }
}
