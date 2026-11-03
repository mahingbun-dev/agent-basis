import { defineConfig } from 'vitest/config'

// 每包 vitest 配置约定:node 环境、只收 tests/**/*.spec.ts。
// tests/*.types.ts 为纯类型钉住文件,由 tsc --noEmit 消费,vitest 不运行。
// node:sqlite 在 node:internal 环境可用(root engines: node>=22)。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
