import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { ApprovalTokenService, hashApprovalToken } from '../src/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'basis-channels-token-'))
const dbPath = join(dir, 'tokens.db')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fakeClock(startMs: number): { now: () => number; advance: (ms: number) => void } {
  let current = startMs
  return { now: (): number => current, advance: (ms: number): void => { current += ms } }
}

describe('ApprovalTokenService:单次有效与过期(邮件审批防伪造核心)', () => {
  it('issuePair 签出 approve/reject 各一枚,令牌互不相同且足够长', () => {
    const tokens = ApprovalTokenService.open(':memory:')
    try {
      const pair = tokens.issuePair({ approvalRequestId: 'apr-1', sessionId: 'sess-1' })
      expect(pair.approve.decision).toBe('approve')
      expect(pair.reject.decision).toBe('reject')
      expect(pair.approve.token).not.toEqual(pair.reject.token)
      expect(pair.approve.token.length).toBeGreaterThanOrEqual(40)
      expect(pair.approve.expiresAt).toBeGreaterThan(pair.approve.issuedAt)
    } finally {
      tokens.close()
    }
  })

  it('redeem 单次有效:第二次同令牌一律拒绝(防重放)', () => {
    const tokens = ApprovalTokenService.open(':memory:')
    try {
      const grant = tokens.issue({ approvalRequestId: 'apr-2', sessionId: 'sess-2', decision: 'approve', ttlMs: 60_000 })
      const first = tokens.redeem(grant.token)
      expect(first).toEqual({
        ok: true,
        approvalRequestId: 'apr-2',
        sessionId: 'sess-2',
        decision: 'approve',
      })
      const replay = tokens.redeem(grant.token)
      expect(replay).toEqual({ ok: false, reason: 'already-used' })
      // 第三次依旧拒绝,且不再产生任何副作用
      expect(tokens.redeem(grant.token)).toEqual({ ok: false, reason: 'already-used' })
    } finally {
      tokens.close()
    }
  })

  it('同请求的 reject 令牌独立单次:approve 消费后 reject 仍可用', () => {
    const tokens = ApprovalTokenService.open(':memory:')
    try {
      const pair = tokens.issuePair({ approvalRequestId: 'apr-3', sessionId: 'sess-3' })
      expect(tokens.redeem(pair.approve.token).ok).toBe(true)
      const rejectResult = tokens.redeem(pair.reject.token)
      expect(rejectResult).toMatchObject({ ok: true, decision: 'reject' })
      expect(tokens.redeem(pair.reject.token)).toEqual({ ok: false, reason: 'already-used' })
    } finally {
      tokens.close()
    }
  })

  it('过期令牌返回 expired,且不消费(时钟推进验证)', () => {
    const clock = fakeClock(1_000_000)
    const tokens = new ApprovalTokenService(new DatabaseSync(':memory:'), { now: clock.now })
    try {
      const grant = tokens.issue({ approvalRequestId: 'apr-4', sessionId: 'sess-4', decision: 'approve', ttlMs: 5_000 })
      clock.advance(4_999)
      expect(tokens.redeem(grant.token).ok).toBe(true)

      const late = tokens.issue({ approvalRequestId: 'apr-4b', sessionId: 'sess-4', decision: 'approve', ttlMs: 5_000 })
      clock.advance(5_001)
      expect(tokens.redeem(late.token)).toEqual({ ok: false, reason: 'expired' })
    } finally {
      tokens.close()
    }
  })

  it('边界:恰好到期时刻 redeem 拒绝;未到边界放行', () => {
    const clock = fakeClock(0)
    const tokens = new ApprovalTokenService(new DatabaseSync(':memory:'), { now: clock.now })
    try {
      const grant = tokens.issue({ approvalRequestId: 'apr-5', sessionId: 'sess-5', decision: 'reject', ttlMs: 1_000 })
      clock.advance(999)
      expect(tokens.redeem(grant.token).ok).toBe(true)
      const edge = tokens.issue({ approvalRequestId: 'apr-5b', sessionId: 'sess-5', decision: 'reject', ttlMs: 1_000 })
      clock.advance(1_000)
      expect(tokens.redeem(edge.token)).toEqual({ ok: false, reason: 'expired' })
    } finally {
      tokens.close()
    }
  })

  it('未知令牌 → unknown-token;revokeAll 后未用令牌全部作废', () => {
    const tokens = ApprovalTokenService.open(':memory:')
    try {
      expect(tokens.redeem('no-such-token')).toEqual({ ok: false, reason: 'unknown-token' })
      const pair = tokens.issuePair({ approvalRequestId: 'apr-6', sessionId: 'sess-6' })
      expect(tokens.pendingCount('apr-6')).toBe(2)
      // 审批已在别处应答(如 Web UI)→ 作废该请求全部令牌
      expect(tokens.revokeAll('apr-6')).toBe(2)
      expect(tokens.redeem(pair.approve.token)).toEqual({ ok: false, reason: 'unknown-token' })
      expect(tokens.redeem(pair.reject.token)).toEqual({ ok: false, reason: 'unknown-token' })
      expect(tokens.pendingCount('apr-6')).toBe(0)
    } finally {
      tokens.close()
    }
  })

  it('库文件不落明文令牌(只存 sha256 摘要)', () => {
    const tokens = ApprovalTokenService.open(dbPath)
    const grant = tokens.issue({ approvalRequestId: 'apr-7', sessionId: 'sess-7', decision: 'approve', ttlMs: 60_000 })
    tokens.close()
    const raw = readFileSync(dbPath, 'utf8')
    expect(raw.includes(grant.token)).toBe(false)
    expect(raw.includes(hashApprovalToken(grant.token))).toBe(true)
  })

  it('签发入参校验:空请求 ID / 非 ttl 正数拒绝', () => {
    const tokens = ApprovalTokenService.open(':memory:')
    try {
      expect(() => tokens.issue({ approvalRequestId: '', sessionId: 's', decision: 'approve', ttlMs: 1000 })).toThrow()
      expect(() => tokens.issue({ approvalRequestId: 'a', sessionId: 's', decision: 'approve', ttlMs: 0 })).toThrow()
      expect(() => tokens.issue({ approvalRequestId: 'a', sessionId: 's', decision: 'approve', ttlMs: Number.NaN })).toThrow()
    } finally {
      tokens.close()
    }
  })
})
