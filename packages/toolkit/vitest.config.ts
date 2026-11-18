import { defineConfig } from 'vitest/config'

// 每包 vitest 配置约定(照 compaction 包逐字形态):node 环境、只收 tests/**/*.spec.ts。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
