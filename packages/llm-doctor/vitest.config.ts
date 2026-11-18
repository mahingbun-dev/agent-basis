import { defineConfig } from 'vitest/config'

// include 增补 *.spec.ts:36 号 §6 门禁总表将 K4.2 测试定名为
// packages/llm-doctor/tests/capability-probe.spec.ts(原包内惯例 *.test.ts,两者并存)。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
  },
})
