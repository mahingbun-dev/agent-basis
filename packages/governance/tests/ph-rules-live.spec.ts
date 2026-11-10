/** G-PH-01 规则活性规格:解析「测试容器渲染产物」并断言 allow-fs 命中 read。
 *
 * 由 ph-gate.mjs 先 docker cp 容器内 /data/.eterna/governance.rules.yml 到临时路径,
 * 以环境变量 GATE_RENDERED_RULES 传入后运行 `pnpm --filter @eterna/governance exec vitest run tests/ph-rules-live`。
 * 无该环境变量时全部跳过(常规 CI 不依赖容器;引擎构造惰性化——describe 回调在 skip 下仍会执行)。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { RuleEngine } from '../src/rules.ts'

const rendered = process.env.GATE_RENDERED_RULES ?? ''
const hasFixture = rendered !== '' && existsSync(rendered)

describe('G-PH-01 渲染产物活性', () => {
  const engine = () => RuleEngine.parse(readFileSync(rendered, 'utf8'), 'container:/data/.eterna/governance.rules.yml')

  it.skipIf(!hasFixture)('default 为 ask(fail-closed 底线不动)', () => {
    expect(engine().policy.default).toBe('ask')
  })

  it.skipIf(!hasFixture)('allow-fs 规则命中 read/glob(空规则×never 全拒事故的反证)', () => {
    expect(engine().evaluate('read').decision).toBe('allow')
    expect(engine().evaluate('glob').decision).toBe('allow')
    expect(engine().evaluate('bash').decision).toBe('allow')
    expect(engine().evaluate('list_agents').decision).toBe('allow')
  })

  it.skipIf(!hasFixture)('working_directory 维持 ask(PH-3 刻意不列)', () => {
    expect(engine().evaluate('working_directory').decision).toBe('ask')
  })
})
