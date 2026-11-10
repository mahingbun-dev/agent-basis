/** G-PH-01 规则活性规格:解析「测试容器渲染产物」并断言 allow-fs 命中 read。
 *
 * 由 ph-gate.mjs 先 docker cp 容器内 /data/.eterna/governance.rules.yml 到临时路径,
 * 以环境变量 GATE_RENDERED_RULES 传入后运行 `pnpm --filter @eterna/governance run test -- --run ph-rules-live`。
 * 无该环境变量时跳过(常规 CI 不依赖容器)。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { RuleEngine } from '../src/rules.ts'

const rendered = process.env.GATE_RENDERED_RULES ?? ''

describe.skipIf(rendered === '' || !existsSync(rendered))('G-PH-01 渲染产物活性', () => {
  const engine = RuleEngine.parse(readFileSync(rendered, 'utf8'), 'container:/data/.eterna/governance.rules.yml')

  it('default 为 ask(fail-closed 底线不动)', () => {
    expect(engine.policy.default).toBe('ask')
  })

  it('allow-fs 规则命中 read/glob(空规则×never 全拒事故的反证)', () => {
    expect(engine.evaluate('read').decision).toBe('allow')
    expect(engine.evaluate('glob').decision).toBe('allow')
    expect(engine.evaluate('bash').decision).toBe('allow')
    expect(engine.evaluate('list_agents').decision).toBe('allow')
  })

  it('working_directory 维持 ask(PH-3 刻意不列)', () => {
    expect(engine.evaluate('working_directory').decision).toBe('ask')
  })
})
