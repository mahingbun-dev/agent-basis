/**
 * 一次性审批令牌(one-time approval token)—— 邮件审批防伪造的核心。
 *
 * 12 号文档 §7.7:"邮件审批必须防伪造:一次性令牌/签名链接,禁止解析正文'同意'
 * 字样放行"。本模块实现签发与校验:
 *
 * - 签发:token = 32 字节 CSPRNG(base64url);落库只存 sha256 摘要,并绑定
 *   approval_request_id + session_id + decision(approve/reject 各一枚)+ 过期时间。
 * - 校验(redeem):单次有效 —— 成功即写 redeemed_at,同 token 再来一律拒绝
 *   (already-used),防重放;过期返回 expired;未知返回 unknown-token。
 *   node:sqlite DatabaseSync 同步单连接,redeem 的查-改在一个同步临界区内完成。
 * - revokeAll:审批已在其他渠道(如 Web UI)应答时,作废该请求全部未用令牌,
 *   防止"邮件令牌迟点再点"复活已结束的审批。
 */
import { createHash, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { ApprovalDecision } from './types.ts'

export interface ApprovalTokenIssueInput {
  readonly approvalRequestId: string
  readonly sessionId: string
  readonly decision: ApprovalDecision
  /** 有效期(毫秒)。 */
  readonly ttlMs: number
}

export interface ApprovalTokenGrant {
  readonly token: string
  readonly approvalRequestId: string
  readonly decision: ApprovalDecision
  readonly issuedAt: number
  readonly expiresAt: number
}

export type ApprovalTokenRedemption =
  | {
    readonly ok: true
    readonly approvalRequestId: string
    readonly sessionId: string
    readonly decision: ApprovalDecision
  }
  | {
    readonly ok: false
    readonly reason: 'unknown-token' | 'expired' | 'already-used'
  }

export interface ApprovalTokenServiceOptions {
  /** 可注入时钟(测试过期语义);默认 Date.now。 */
  readonly now?: () => number
  /** 默认 30 分钟。 */
  readonly defaultTtlMs?: number
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS approval_tokens (
  token_hash TEXT PRIMARY KEY,
  approval_request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_request ON approval_tokens(approval_request_id);
`

interface TokenRow {
  token_hash: string
  approval_request_id: string
  session_id: string
  decision: string
  issued_at: number
  expires_at: number
  redeemed_at: number | null
}

export function hashApprovalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export class ApprovalTokenService {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly defaultTtlMs: number

  constructor(db: DatabaseSync, options: ApprovalTokenServiceOptions = {}) {
    this.db = db
    this.now = options.now ?? ((): number => Date.now())
    this.defaultTtlMs = options.defaultTtlMs ?? 30 * 60 * 1000
    this.db.exec(MIGRATION)
  }

  static open(path: string, options?: ApprovalTokenServiceOptions): ApprovalTokenService {
    return new ApprovalTokenService(new DatabaseSync(path), options)
  }

  /**
   * 签发一枚绑定 (approvalRequestId, sessionId, decision) 的一次性令牌。
   * approve/reject 应各签发一枚(同一请求可并存多枚令牌,互不干扰、各自单次)。
   */
  issue(input: ApprovalTokenIssueInput): ApprovalTokenGrant {
    if (input.approvalRequestId.length === 0 || input.sessionId.length === 0) {
      throw new Error('[channels] 令牌签发参数不能为空')
    }
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
      throw new Error('[channels] ttlMs 必须为正数')
    }
    const token = randomBytes(32).toString('base64url')
    const issuedAt = this.now()
    const expiresAt = issuedAt + input.ttlMs
    this.db
      .prepare('INSERT INTO approval_tokens (token_hash, approval_request_id, session_id, decision, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        hashApprovalToken(token),
        input.approvalRequestId,
        input.sessionId,
        input.decision,
        issuedAt,
        expiresAt,
      )
    return {
      token,
      approvalRequestId: input.approvalRequestId,
      decision: input.decision,
      issuedAt,
      expiresAt,
    }
  }

  /** 便捷签发:按默认 TTL 一次签出 approve+reject 两枚(邮件/卡片双按钮)。 */
  issuePair(input: Omit<ApprovalTokenIssueInput, 'decision' | 'ttlMs'> & { readonly ttlMs?: number }): {
    readonly approve: ApprovalTokenGrant
    readonly reject: ApprovalTokenGrant
  } {
    const ttlMs = input.ttlMs ?? this.defaultTtlMs
    return {
      approve: this.issue({ ...input, ttlMs, decision: 'approve' }),
      reject: this.issue({ ...input, ttlMs, decision: 'reject' }),
    }
  }

  /**
   * 校验并消费令牌(单次有效):
   * ok → 同时落 redeemed_at,返回绑定的请求/会话/决定;
   * already-used / expired / unknown-token → 不产生任何审批副作用。
   */
  redeem(token: string): ApprovalTokenRedemption {
    const tokenHash = hashApprovalToken(token)
    const row = this.db
      .prepare('SELECT token_hash, approval_request_id, session_id, decision, issued_at, expires_at, redeemed_at FROM approval_tokens WHERE token_hash = ?')
      .get(tokenHash) as TokenRow | undefined
    if (row === undefined) return { ok: false, reason: 'unknown-token' }
    if (row.redeemed_at !== null) return { ok: false, reason: 'already-used' }
    if (this.now() >= row.expires_at) return { ok: false, reason: 'expired' }
    const changed = Number(this.db
      .prepare('UPDATE approval_tokens SET redeemed_at = ? WHERE token_hash = ? AND redeemed_at IS NULL')
      .run(this.now(), tokenHash).changes)
    if (changed !== 1) return { ok: false, reason: 'already-used' }
    const decision: ApprovalDecision = row.decision === 'approve' ? 'approve' : 'reject'
    return {
      ok: true,
      approvalRequestId: row.approval_request_id,
      sessionId: row.session_id,
      decision,
    }
  }

  /** 作废某审批请求的全部未用令牌;返回作废数量。 */
  revokeAll(approvalRequestId: string): number {
    return Number(this.db
      .prepare('DELETE FROM approval_tokens WHERE approval_request_id = ?')
      .run(approvalRequestId).changes)
  }

  /** 未消费且未过期的令牌数(观测用)。 */
  pendingCount(approvalRequestId?: string): number {
    const now = this.now()
    if (approvalRequestId === undefined) {
      const row = this.db
        .prepare('SELECT COUNT(*) AS n FROM approval_tokens WHERE redeemed_at IS NULL AND expires_at > ?')
        .get(now) as { n: number }
      return row.n
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM approval_tokens WHERE approval_request_id = ? AND redeemed_at IS NULL AND expires_at > ?')
      .get(approvalRequestId, now) as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
