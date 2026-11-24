/**
 * 上游 `startActivation` 形态适配门禁(2026-11-24)。
 *
 * ## 为什么需要这个测试
 * DSH 在 0.2.2 的 alpha 线与 rc 线之间把 `parent` / `prompt` / `agentPreset`
 * 从 `spec.request` 子对象搬到了 spec **顶层**,两版不兼容:
 *
 * | 版本 | 形态 | 现场 |
 * |---|---|---|
 * | `0.2.2-alpha.2` | `spec.request.{parent,prompt,agentPreset}` | 仓库 catalog 钉版 |
 * | `0.2.2-rc.1` / `rc.5` | `spec.{parent,prompt,agentPreset}` | 本地 dsh、生产镜像 |
 *
 * 认错形态的失败**不是**清晰的类型错误,而是 `Cannot read properties of
 * undefined (reading 'id')`——在真实 boot 里表现为 HTTP 503。单测的假端口按
 * 我们的假设写,永远测不出:P5 的浏览器验证就是因此才发现这个缺陷
 * (单测 64 绿、真机 create 恒 503)。
 *
 * 本文件把结论钉成三层:
 * 1. **双写契约**:端口交给上游的对象同时含顶层三字段与 `request` 装箱;
 * 2. **传给上游的就是活 Agent 本身**(不是结构件);
 * 3. **形态漂移探针**:扫描已安装上游包的 `lib/index.js`,确认至少有一条已知
 *    形态在磁盘上成立;两条都读不到时说明上游又改了 API,本文件必须重审
 *    (而不是静默继续)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHostPorts } from '../src/host.ts'

const repoRoot = join(import.meta.dirname, '..', '..', '..')

/** 一个最小可用 Agent 替身(端口只做形状检查:`id` + `inject` + `followup`)。 */
function fakeAgent(id: string): { id: string; inject: () => void; followup: () => void } {
  return { id, inject: () => {}, followup: () => {} }
}

/** 一个只提供 `get` 的 agents 注册表替身。 */
function fakeCtx(services: Record<string, unknown>): { ctx: never } {
  return {
    ctx: {
      get: (name: string) => services[name],
    } as never,
  }
}

interface CapturedSpec {
  readonly [key: string]: unknown
}

describe('startActivation 形态双写(alpha 装箱 + rc 平铺)', () => {
  /** 跑一次 startActivation,回收端口实际交给上游的那个 spec。 */
  async function captureSpec(): Promise<{ captured: CapturedSpec; agent: ReturnType<typeof fakeAgent> }> {
    const agent = fakeAgent('p1')
    let captured: CapturedSpec = {}
    const { ctx } = fakeCtx({
      agents: { get: (id: string) => (id === 'p1' ? agent : undefined) },
      subagents: {
        startActivation: async (spec: CapturedSpec) => {
          captured = spec
          return { childId: 'c1', messageId: 'm1' }
        },
        listDescendants: async () => [],
      },
    })
    await createHostPorts(ctx).startActivation({
      provider: 'spawn',
      label: 'adviser',
      name: 'adviser-1',
      childId: 'c1',
      request: { parent: { id: 'p1' }, prompt: [{ type: 'text', text: '开场' }], agentPreset: 'eterna-adviser' },
      signal: new AbortController().signal,
      delivery: 'caller',
    })
    return { captured, agent }
  }

  it('rc 线(0.2.2-rc.1 / rc.5):顶层平铺三字段齐备', async () => {
    const { captured, agent } = await captureSpec()
    // 上游 rc 线的判别字段:assertCapabilities 直接读 spec.agentPreset。
    expect(captured['agentPreset']).toBe('eterna-adviser')
    expect(captured['prompt']).toEqual([{ type: 'text', text: '开场' }])
    // parent 必须是活 Agent 本尊(上游做身份恒等校验:`get(parent.id) !== parent` → UNAUTHORIZED)。
    expect(captured['parent']).toBe(agent)
  })

  it('alpha 线(0.2.2-alpha.2):request 子对象装箱三字段齐备', async () => {
    const { captured, agent } = await captureSpec()
    const request = captured['request'] as Record<string, unknown> | undefined
    expect(request).toBeDefined()
    expect(request?.['agentPreset']).toBe('eterna-adviser')
    expect(request?.['prompt']).toEqual([{ type: 'text', text: '开场' }])
    expect(request?.['parent']).toBe(agent)
  })

  it('两条线的字段值来自同一份入参(不会各自漂移)', async () => {
    const { captured } = await captureSpec()
    const request = captured['request'] as Record<string, unknown>
    expect(request['parent']).toBe(captured['parent'])
    expect(request['prompt']).toBe(captured['prompt'])
    expect(request['agentPreset']).toBe(captured['agentPreset'])
  })

  it('provider/label/name/childId/signal/delivery 只在顶层(两版一致,不放 request)', async () => {
    const { captured } = await captureSpec()
    expect(captured['provider']).toBe('spawn')
    expect(captured['label']).toBe('adviser')
    expect(captured['name']).toBe('adviser-1')
    expect(captured['childId']).toBe('c1')
    expect(captured['delivery']).toBe('caller')
    expect(captured['signal']).toBeInstanceOf(AbortSignal)
    const request = captured['request'] as Record<string, unknown>
    expect(request['provider']).toBeUndefined()
    expect(request['childId']).toBeUndefined()
  })
})

// ── 已安装上游包的真实形态探针 ──────────────────────────────────────────────

/**
 * 本机已安装的 `@deepseek-ai/dsh-subagent` 副本。
 *
 * 两个来源都要看,因为它们**可能形态不同**:
 * - 仓库 `node_modules/.pnpm`(npm 发布线:catalog 钉的 alpha.2 + 传递依赖的 rc.1);
 * - `deepseek-harness` 的本地开发构建(`~/.dsh/profiles/node_modules` 链过去的那份,
 *   实机 boot 用的就是它)。
 *
 * 2026-11-24 实测:同样标 `0.2.2-rc.1`,npm 发布线读 `spec.request.parent`,
 * 而 harness 开发构建与生产 rc.5 镜像读 `spec.parent`。这就是必须双写的原因。
 */
function installedCopies(): string[] {
  const roots = [
    join(repoRoot, 'node_modules', '.pnpm'),
    join('/Users/sunny/code/deepseek-harness/apps/cli/node_modules/@deepseek-ai/dsh-base/node_modules/@deepseek-ai/dsh-subagent/lib'),
  ]
  const fromPnpm = existsSync(roots[0] as string)
    ? readdirSync(roots[0] as string)
      .filter(entry => entry.startsWith('@deepseek-ai+dsh-subagent@'))
      .map(entry => join(roots[0] as string, entry, 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'index.js'))
    : []
  const direct = roots[1] === undefined ? [] : [join(roots[1], 'index.js')]
  return [...fromPnpm, ...direct].filter(path => existsSync(path))
}

/** 一份上游实现的字段形态。 */
type Shape = 'request-wrapped' | 'flat'

/**
 * 判定一份实现读哪种形态(按它做 parent 恒等校验的那行)。
 * @param code - 上游 lib/index.js 文本。
 * @returns 形态;两行都读不到时为 undefined(上游改了 API → 必须重审本测试)。
 */
function shapeOf(code: string): Shape | undefined {
  if (code.includes('get(spec.request.parent.id)')) return 'request-wrapped'
  if (code.includes('get(spec.parent.id)')) return 'flat'
  return undefined
}

describe('上游 startActivation 形态漂移探针', () => {
  const copies = installedCopies()

  it('本机至少有一份 dsh-subagent 已安装(否则本探针无意义)', () => {
    expect(copies.length).toBeGreaterThan(0)
  })

  it('每份副本的形态都可识别(识别不出 = 上游改了 API,必须重审双写)', () => {
    const unknown = copies.filter(path => shapeOf(readFileSync(path, 'utf8')) === undefined)
    expect(unknown, `无法判定形态的副本:\n${unknown.join('\n')}`).toEqual([])
  })

  it('端口交出的 spec 同时满足两种形态', async () => {
    const agent = fakeAgent('p1')
    let captured: CapturedSpec = {}
    const { ctx } = fakeCtx({
      agents: { get: (id: string) => (id === 'p1' ? agent : undefined) },
      subagents: {
        startActivation: async (spec: CapturedSpec) => {
          captured = spec
          return { childId: 'c1', messageId: 'm1' }
        },
        listDescendants: async () => [],
      },
    })
    await createHostPorts(ctx).startActivation({
      provider: 'spawn', label: 'adviser', name: 'adviser-1', childId: 'c1',
      request: { parent: { id: 'p1' }, prompt: [{ type: 'text', text: '开场' }], agentPreset: 'eterna-adviser' },
      signal: new AbortController().signal, delivery: 'caller',
    })
    const request = captured['request'] as Record<string, unknown>
    for (const path of copies) {
      const shape = shapeOf(readFileSync(path, 'utf8'))
      // 按该副本实际读的位置逐项断言——这正是它在真机会读到的字段。
      const parent = shape === 'flat' ? captured['parent'] : request['parent']
      const prompt = shape === 'flat' ? captured['prompt'] : request['prompt']
      const preset = shape === 'flat' ? captured['agentPreset'] : request['agentPreset']
      expect(parent, `${path} (${String(shape)}) 读到 parent`).toBe(agent)
      expect(prompt, `${path} (${String(shape)}) 读到 prompt`).toEqual([{ type: 'text', text: '开场' }])
      expect(preset, `${path} (${String(shape)}) 读到 agentPreset`).toBe('eterna-adviser')
    }
  })
})
