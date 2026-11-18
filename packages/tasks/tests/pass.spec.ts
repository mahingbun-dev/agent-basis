/**
 * pass 驱动与暂停顺延(35 号 A16/A27 具名门禁 tests/pass.spec.ts;34 §4-G「passes.spec.ts →
 * tests/pass.spec.ts」判据:pass 调度合并、暂停时 deadline 顺延、恢复重排)。
 *
 * 承接说明:SA tests/passes.spec.ts 的被测对象是 SA src/app/passes.ts;本仓 34 §2.6 第二行
 * 「SA passes.ts 不整体移植、机制并入装配、按需重写」——
 * - pass 周期合并调度 = src/plugin.ts 的 PassDriver(28 号 §8-3 pass 周期,24a C6);
 * - 暂停时 deadline 顺延与恢复重排 = src/core/evals.ts `due()` 的 pausedAt 语义
 *   (处理暂停期间不到期,恢复后按暂停时长顺延——Engine.evaluateDue 头注原文);
 * - SA「stop 后不再启动定时器」承接为 PassDriver.stop 停驱动(装配 dispose 即停);
 *   SA 失败上报健康面的半边随装配健康面(34 §4-G health 行,health.spec.ts 承接)。
 * 假件模式承 34 §4-A:fixtures/engine.ts(MemoryRepositories + 假 Policy/Assessor/Executor)。
 */
import { describe, expect, it, vi } from 'vitest'
import { UserError } from '../src/index.ts'
import { PassDriver } from '../src/plugin.ts'
import { engineHarness, trigger } from './fixtures/engine.ts'

describe('PassDriver——pass 周期合并调度(35-A16「pass 驱动…机制并入装配」)', () => {
  it('合并:pass 在跑时不重入;跑完即清,下一轮照常(欠账一次,不排队堆积)', () => {
    let calls = 0
    const driver = new PassDriver({ evaluateDue: () => { calls += 1; if (calls === 1) driver.pass() } }, 60_000)
    driver.pass()
    // 一轮 pass 执行中的重入请求被丢弃:evaluateDue 只执行了一次。
    expect(calls).toBe(1)
    driver.pass()
    expect(calls).toBe(2)
  })
  it('周期驱动:start 后按 interval 触发 evaluateDue;stop 后不再触发,重新 start 恢复驱动', async () => {
    const evaluateDue = vi.fn()
    const driver = new PassDriver({ evaluateDue }, 20)
    driver.start()
    await vi.waitFor(() => { expect(evaluateDue.mock.calls.length).toBeGreaterThanOrEqual(2) })
    driver.stop()
    const after = evaluateDue.mock.calls.length
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    expect(evaluateDue.mock.calls.length).toBe(after)
    driver.start()
    await vi.waitFor(() => { expect(evaluateDue.mock.calls.length).toBeGreaterThan(after) })
    driver.stop()
    expect(evaluateDue.mock.calls.length).toBeGreaterThan(after)
  })
  it('start 幂等:重复 start 不叠定时器(同一周期只一路驱动)', async () => {
    const evaluateDue = vi.fn()
    const driver = new PassDriver({ evaluateDue }, 20)
    driver.start(); driver.start(); driver.start()
    await vi.waitFor(() => { expect(evaluateDue.mock.calls.length).toBeGreaterThanOrEqual(2) })
    const pace = evaluateDue.mock.calls.length
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    // 不叠加:80ms 窗口在 20ms 周期下约 4 跳(叠加三路会 ≥9 跳)。
    expect(evaluateDue.mock.calls.length - pace).toBeLessThan(9)
    driver.stop()
  })
})

describe('暂停时 deadline 顺延与恢复重排(34 §4-G:evals due() 的 pausedAt 语义)', () => {
  it('处理暂停期间 Eval 不到期(记 pausedAt);恢复后 deadline 按暂停时长顺延,可照常裁决', () => {
    const h = engineHarness()
    h.engine.receive(trigger('1')); h.pump()
    const candidate = h.requests.at(-1)!
    h.engine.candidateDelivered(candidate.evalId)
    const thread = () => h.repo.threads.get('chat:t1')
    const deadline0 = Date.parse(thread()?.evaluating?.deadline ?? '')
    h.setPaused(true); h.tick(10)
    h.engine.evaluateDue()
    // 暂停开始:记 pausedAt、不到期。
    expect(thread()?.evaluating?.pausedAt).not.toBeUndefined()
    h.tick(120)
    h.engine.evaluateDue()
    // 越过原 deadline 也不过期:无重排、无 unavailable Decision。
    expect(thread()?.evaluating?.pausedAt).not.toBeUndefined()
    expect(h.repo.decisions.byThread('chat:t1')).toHaveLength(0)
    h.setPaused(false); h.tick(1)
    h.engine.evaluateDue()
    // 恢复:deadline 顺延暂停时长(恢复时点 131s − 暂停开始 10s = +121s),pausedAt 清除。
    const deadline1 = Date.parse(thread()?.evaluating?.deadline ?? '')
    expect(deadline1).toBe(deadline0 + 121_000)
    expect(thread()?.evaluating?.pausedAt).toBeUndefined()
    expect(h.decide(candidate, { kind: 'ignore', reason: 'chatter' }).kind).toBe('ignore')
  })
  it('对照:无暂停时同样间隔即过期重排(同一 pass 内重排并重启新 Eval)——顺延只在暂停路径', () => {
    const h = engineHarness()
    h.engine.receive(trigger('1')); h.pump()
    const candidate = h.requests.at(-1)!
    h.engine.candidateDelivered(candidate.evalId)
    h.tick(61)
    h.engine.evaluateDue()
    // 过期:旧 Eval 终结、Trigger 回队并在同一 pass 内以新 Eval 重启(恢复重排语义的对照面)。
    const restarted = h.repo.threads.get('chat:t1')?.evaluating
    expect(restarted).not.toBeUndefined()
    expect(restarted?.id).not.toBe(candidate.evalId)
    expect(restarted?.startedAt).toBe('2026-09-23T00:01:01.000Z')
    // 旧 evalId 的裁决被拒(evalFinished):重排后只有新 Eval 可裁决。
    expect(() => h.decide(candidate, { kind: 'ignore', reason: 'late', evalId: candidate.evalId }))
      .toThrow(new UserError('evalFinished', { eval: candidate.evalId }))
  })
})
