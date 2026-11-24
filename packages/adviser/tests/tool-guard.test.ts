/**
 * 工具面守门的契约单测(P4 收尾)。
 *
 * 这里钉的是**产品承诺**——「参谋只读」在真实部署里是否成立:
 *
 * 1. **未知的全局工具默认被 deny**(fail-closed):将来任何插件新注册的全局写工具
 *    都自动被挡,不需要回来改清单。
 * 2. **只读白名单放行**:`working_directory` 与 knowledge 只读三件必须可见,否则
 *    参谋连「在哪个目录」「知识库有什么」都问不了。
 * 3. **`knowledge_propose` 永不放行**:它是写操作,与只读三件由同一个插件一起注册,
 *    所以清单必须逐名列举、不能用通配。
 * 4. **晚注册追捕**:全局工具可能在守门之后才注册(装载顺序由服务可用性驱动,
 *    access 热挂插件更是运行期随时注册),订阅 `tools/change` 后必须追上。
 * 5. **不自递归**:`restrict()` 自身会 emit `tools/change`;同步调用会爆栈
 *    (实机 RangeError 实证),必须用 microtask 跳出。
 * 6. **幂等**:同一名字不重复 deny,否则限制会随变更次数累积。
 * 7. **不影响父会话**:限制只施加在 scope 链上,根 ctx 视图必须照旧。
 */
import { describe, expect, it, vi } from 'vitest'
import { ADVISER_ALLOWED_GLOBAL_TOOLS, createToolGuard } from '../src/tool-guard.ts'

/** 造一个守门假 ctx:全局工具名表 + restrict 记录 + 可手动触发的 tools/change。 */
function fakeContext(initialNames: readonly string[]) {
  const names = new Set(initialNames)
  const restrictCalls: Array<{ allow?: readonly string[]; deny?: readonly string[] }> = []
  const listeners: (() => void)[] = []
  const compromise = {
    /** 追加一个全局工具名(模拟晚注册)。 */
    add(name: string) { names.add(name) },
    /** 移除一个全局工具名。 */
    remove(name: string) { names.delete(name) },
    /** 触发 tools/change(上游在 register/restrict 后都会 emit)。 */
    emitChange() { for (const listener of [...listeners]) listener() },
    /** 当前累计的 deny 面(去重后)。 */
    deniedNames(): readonly string[] {
      return [...new Set(restrictCalls.flatMap(call => call.deny ?? []))].sort()
    },
    restrictCalls,
  }
  const ctx = {
    tools: {
      definitions: () => [...names].map(name => ({ name })),
      restrict: (filter: { allow?: readonly string[]; deny?: readonly string[] }) => {
        restrictCalls.push(filter)
        // 上游客观行为:restrict 自身 emit tools/change(自递归的根源)。
        compromise.emitChange()
        return () => { /* 撤销 */ }
      },
    },
    on: (event: string, listener: () => void) => {
      if (event === 'tools/change') listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
  return { ctx, ...compromise }
}

/** 让 microtask 队列排空(queueMicrotask 是守门跳出递归的手段)。 */
async function flushMicrotasks(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('只读白名单', () => {
  it('放行 working_directory(只读定位工具)', () => {
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).toContain('working_directory')
  })

  it('放行知识库只读三件(否则参谋查不了知识库)', () => {
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).toContain('knowledge_search')
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).toContain('knowledge_read')
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).toContain('knowledge_status')
  })

  it('永不放行 knowledge_propose(写操作;与只读三件同插件注册,必须逐名列举)', () => {
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).not.toContain('knowledge_propose')
  })

  it('永不放行记忆写入与插件安装', () => {
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).not.toContain('memory_write')
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).not.toContain('memory_forget')
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS).not.toContain('install_personal_plugin')
  })

  it('白名单里没有通配符(逐名列举是这条纪律的载体)', () => {
    expect(ADVISER_ALLOWED_GLOBAL_TOOLS.every(name => !name.includes('*'))).toBe(true)
  })
})

describe('守门:挂载即封全局写工具', () => {
  it('deny = 全部全局工具 − 白名单', () => {
    const fake = fakeContext([
      'working_directory', 'knowledge_search', 'knowledge_read', 'knowledge_status',
      'knowledge_propose', 'memory_write', 'install_personal_plugin',
    ])
    createToolGuard(fake.ctx)
    expect(fake.deniedNames()).toEqual(['install_personal_plugin', 'knowledge_propose', 'memory_write'])
  })

  it('全是白名单工具时不发 restrict(空 deny 面没有意义)', () => {
    const fake = fakeContext(['working_directory', 'knowledge_search'])
    createToolGuard(fake.ctx)
    expect(fake.restrictCalls).toHaveLength(0)
  })

  it('tools 服务缺席时返回空守卫,不抛', () => {
    const guard = createToolGuard({})
    expect(() => { guard.sync() }).not.toThrow()
    expect(() => { guard.dispose() }).not.toThrow()
  })

  it('restrict 抛错时静默降级(不炸预设挂载)', () => {
    const ctx = {
      tools: {
        definitions: () => [{ name: 'knowledge_propose' }],
        restrict: () => { throw new Error('restrict() requires a scoped context') },
      },
    }
    expect(() => createToolGuard(ctx as never)).not.toThrow()
  })
})

describe('守门:晚注册追捕', () => {
  it('守门之后注册的全局写工具会被追上并 deny', async () => {
    const fake = fakeContext(['working_directory', 'memory_write'])
    createToolGuard(fake.ctx)
    expect(fake.deniedNames()).toEqual(['memory_write'])

    // 晚注册(模拟 access 热挂插件 / glue 晚激活)。
    fake.add('late_writer')
    fake.emitChange()
    await flushMicrotasks()

    expect(fake.deniedNames()).toEqual(['late_writer', 'memory_write'])
  })

  it('晚注册的只读白名单工具不会被 deny', async () => {
    const fake = fakeContext(['working_directory'])
    createToolGuard(fake.ctx)

    fake.add('knowledge_search')
    fake.emitChange()
    await flushMicrotasks()

    expect(fake.deniedNames()).toEqual([])
  })

  it('不在 tools/change 回调里同步 restrict(否则自递归爆栈)', async () => {
    const fake = fakeContext(['working_directory', 'memory_write'])
    // 让 restrict 记录自身被调用时的调用栈深度。
    const depths: number[] = []
    let depth = 0
    const original = fake.ctx.tools.restrict
    fake.ctx.tools.restrict = (filter) => {
      depth += 1
      depths.push(depth)
      try { return original(filter) } finally { depth -= 1 }
    }
    createToolGuard(fake.ctx)
    fake.add('late_writer')
    // emitChange 是同步的;若守门同步 restrict 会在这里立刻递归。
    expect(() => { fake.emitChange() }).not.toThrow()
    await flushMicrotasks()
    // 每次 restrict 都在独立的栈帧(深度恒为 1),证明 microtask 跳出了回调栈。
    expect(depths.every(value => value === 1)).toBe(true)
  })

  it('同一名字不重复 deny(限制不随变更次数累积)', async () => {
    const fake = fakeContext(['working_directory', 'memory_write'])
    createToolGuard(fake.ctx)
    const firstCount = fake.restrictCalls.length
    for (let i = 0; i < 5; i += 1) {
      fake.emitChange()
      await flushMicrotasks()
    }
    expect(fake.restrictCalls.length).toBe(firstCount)
  })

  it('已 deny 的名字被移除后又注册回来,不会重复 deny(denied 集合长期有效)', async () => {
    const fake = fakeContext(['working_directory', 'memory_write'])
    createToolGuard(fake.ctx)
    fake.remove('memory_write')
    fake.emitChange()
    await flushMicrotasks()
    fake.add('memory_write')
    fake.emitChange()
    await flushMicrotasks()
    expect(fake.restrictCalls).toHaveLength(1)
  })
})

describe('守门:生命周期', () => {
  it('dispose 后不再追捕(订阅已撤)', async () => {
    const fake = fakeContext(['working_directory', 'memory_write'])
    const guard = createToolGuard(fake.ctx)
    guard.dispose()
    const before = fake.restrictCalls.length
    fake.add('late_writer')
    fake.emitChange()
    await flushMicrotasks()
    expect(fake.restrictCalls.length).toBe(before)
  })

  it('dispose 幂等', () => {
    const fake = fakeContext(['working_directory', 'memory_write'])
    const guard = createToolGuard(fake.ctx)
    expect(() => { guard.dispose(); guard.dispose() }).not.toThrow()
  })

  it('definitions 抛错时跳过本轮(不炸 types/change 回调)', async () => {
    let throwNow = false
    const fake = fakeContext(['working_directory', 'memory_write'])
    const originalDefinitions = fake.ctx.tools.definitions
    fake.ctx.tools.definitions = () => {
      if (throwNow) throw new Error('视图计算失败')
      return originalDefinitions()
    }
    createToolGuard(fake.ctx)
    throwNow = true
    fake.emitChange()
    await expect(flushMicrotasks()).resolves.toBeUndefined()
  })
})

describe('守门:不影响父会话', () => {
  it('restrict 只在守门自己的 scope 上调用,全局视图不变', () => {
    const fake = fakeContext(['working_directory', 'memory_write'])
    const spy = vi.fn(fake.ctx.tools.restrict)
    fake.ctx.tools.restrict = spy
    createToolGuard(fake.ctx)
    // 守门从不调用带 scope 参数的 definitions(那会取到 agent 视图);
    // 它只取全局视图,而 restrict 由 cordis 归到调用者 scope。
    expect(spy).toHaveBeenCalledWith({ deny: ['memory_write'] })
  })
})
