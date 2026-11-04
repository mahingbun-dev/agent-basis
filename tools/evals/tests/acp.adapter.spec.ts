/**
 * AcpAdapter 协议测试:用同协议 stub driver(无 DSH 依赖)真跑
 * spawn → stdin 配置 → NDJSON 解析 → 事件聚合的完整 TS 管线。
 * 真实 DSH 运行时(pip deepseek-harness-sdk + DSH_HOME + 凭据)联调列入 blockers。
 */
import { describe, expect, it } from 'vitest'
import { AcpAdapter } from '../src/adapters/acp.ts'
import { parseGoldenCase } from '../src/schema.ts'
import type { GoldenCase } from '../src/types.ts'

const STUB_DRIVER = new URL('./fixtures/stub-acp-driver.mjs', import.meta.url).pathname
const NODE = process.execPath

function acpCase(id: string, extra = ''): GoldenCase {
  return parseGoldenCase(`id: ${id}\nuser_input: 干活\n${extra}`, 'memory://acp.yaml')
}

function adapter(): AcpAdapter {
  return new AcpAdapter({
    pythonBin: NODE,
    driverPath: STUB_DRIVER,
    defaults: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
}

describe('AcpAdapter:stub driver 协议', () => {
  it('正常协议流:session + events + ignorable 通知 + 未知行 → 事件/notes/finalResponse', async () => {
    const result = await adapter().run({
      caseData: acpCase('ok-case'),
      packDir: '/tmp',
      workspaceDir: '/tmp',
    })
    expect(result.sessionRef).toBe('stub-session-ok-case')
    expect(result.events.map(event => event.type)).toEqual([
      'turn/start',
      'step/start',
      'assistant/message',
      'approval/asked',
      'approval/decided',
      'driver/notification',
    ])
    expect(result.finalAnswerText).toBe('stub:任务完成')
    expect((result.notes ?? []).join('\n')).toContain('未知 driver 消息 kind=not-a-known-kind')
  })

  it('approval_response 传参:红线 case 按 approval_flow.outcome 应答,缺省 allowed-once', async () => {
    const echoed = async (id: string, extra = ''): Promise<Record<string, unknown>> => {
      const result = await adapter().run({ caseData: acpCase(id, extra), packDir: '/tmp', workspaceDir: '/tmp' })
      const echo = result.events.find(event => event.type === 'driver/notification'
        && typeof (event.data as { echoedConfig?: unknown })?.echoedConfig === 'object')
      return (echo?.data as { echoedConfig?: Record<string, unknown> })?.echoedConfig ?? {}
    }
    // 红线 external-payment/budget-overrun:outcome rejected → driver 收到 rejected
    expect((await echoed('cfg-reject', 'trajectory:\n  approval_flow: { tool: pay_deposit, outcome: rejected }\n')).approval_response).toBe('rejected')
    // 红线 vendor-deposit:outcome allowed-once → driver 收到 allowed-once
    expect((await echoed('cfg-allow', 'trajectory:\n  approval_flow: { tool: pay_deposit, outcome: allowed-once }\n')).approval_response).toBe('allowed-once')
    // 未声明 approval_flow → 缺省 allowed-once(审批不静默挂起)
    expect((await echoed('cfg-plain')).approval_response).toBe('allowed-once')
    // unavailable 是被观测结局而非可发送决定 → 回落 allowed-once
    expect((await echoed('cfg-unavail', 'trajectory:\n  approval_flow: { tool: pay_deposit, outcome: unavailable }\n')).approval_response).toBe('allowed-once')
    // 领域 skills 装载通道:driver 收到 <pack>/skills 绝对路径(经 SDK patches 覆写)
    expect((await echoed('cfg-skill')).skill_dir).toBe('/tmp/skills')
  })

  it('事件数据进入断言口径:审批计数与 usage', async () => {
    const result = await adapter().run({
      caseData: acpCase('metrics-case'),
      packDir: '/tmp',
      workspaceDir: '/tmp',
    })
    const summary = await import('../src/events.ts').then(mod => mod.summarize(result.events))
    expect(summary.approvalsAsked).toHaveLength(1)
    expect(summary.approvalsDecided[0]?.outcome).toBe('rejected')
    expect(summary.totalTokens).toBe(15)
  })

  it('error 协议 → 拒绝并带驱动消息', async () => {
    await expect(adapter().run({
      caseData: acpCase('boom'),
      packDir: '/tmp',
      workspaceDir: '/tmp',
    })).rejects.toThrow('acp: driver 报错: stub: 模拟驱动失败')
  })

  it('超时 → SIGKILL + 拒绝(case 配 timeout_seconds: 1 对 5s 沉睡 stub)', async () => {
    const started = Date.now()
    await expect(adapter().run({
      caseData: acpCase('slow', 'acp: {timeout_seconds: 1}\n'),
      packDir: '/tmp',
      workspaceDir: '/tmp',
    })).rejects.toThrow(/driver 超时\(>1s\)/)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('driver 不存在(python 解释器路径无效)→ 拒绝并给出启动提示', async () => {
    const bad = new AcpAdapter({ pythonBin: '/nonexistent-python-bin', driverPath: STUB_DRIVER })
    await expect(bad.run({
      caseData: acpCase('nopython'),
      packDir: '/tmp',
      workspaceDir: '/tmp',
    })).rejects.toThrow(/无法启动 driver/)
  })

  it('真实 python driver 缺 SDK 时的协议出口(有 python3 的环境才跑)', async () => {
    const hasPython = await import('node:child_process').then(mod =>
      new Promise<boolean>((resolve) => {
        const child = mod.spawn('python3', ['--version'])
        child.on('error', () => {
          resolve(false)
        })
        child.on('close', (code) => {
          resolve(code === 0)
        })
      }),
    )
    if (!hasPython) {
      expect(true).toBe(true)
      return
    }
    const real = new AcpAdapter({ pythonBin: 'python3' })
    await expect(real.run({
      caseData: acpCase('sdk-missing'),
      packDir: '/tmp',
      workspaceDir: '/tmp',
    })).rejects.toThrow(/deepseek-harness-sdk 未安装|运行失败|无法启动/)
  })
})
