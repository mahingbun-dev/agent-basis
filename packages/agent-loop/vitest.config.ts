import { defineConfig } from 'vitest/config'

// 每包 vitest 配置约定:node 环境、只收 tests/**/*.spec.ts。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
