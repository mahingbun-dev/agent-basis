import { describe, expect, it } from 'vitest'
import * as core from '../src/core/index.ts'
import { createTasks } from '../src/index.ts'

// A1 骨架测试:钉门面形状;A3 落地 model/ids/reasons/errors/stage 后,src/core 门面不再为空
// (原「空门面」断言随之升级为内核导出抽查;其余内核行为测试见 stage.spec.ts / model.spec.ts)。
describe('@eterna/tasks A1 包骨架', () => {
  it('门面导出 createTasks 装配入口(35 号 A16 已真实装配;行为与关停配逆判据见 plugin-boot.spec.ts)', () => {
    expect(typeof createTasks).toBe('function')
  })

  it('src/core 内核自 35 号 A3 起逐件落地(当前:model/ids/reasons/errors/stage + 端口组 ports/part/memory)', () => {
    expect(typeof core.followupOwners).toBe('function')
    expect(typeof core.waitsForPerson).toBe('function')
    expect(typeof core.ticketStage).toBe('function')
    expect(typeof core.canRetry).toBe('function')
    expect(typeof core.key).toBe('function')
    expect(typeof core.reasonText).toBe('function')
    expect(typeof core.UserError).toBe('function')
    // 端口组(A3 memory + A5 ports/part):内存仓库经 barrel 导出;EnginePart 不进门面(对齐 SA barrel,经 engine.ts 转出)
    expect(typeof core.MemoryRepositories).toBe('function')
  })
})
