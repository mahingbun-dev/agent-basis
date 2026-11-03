import { defineConfig } from 'vitest/config'

// 每包 vitest 配置约定:node 环境、只收 tests/**/*.spec.ts。
// 跨包源码解析走各包 package.json 的 exports(指向 src/index.ts),无需路径别名。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
