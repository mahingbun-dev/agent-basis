/**
 * vitest 配置(Host 面单测;client 面由 Lead 的 tests/render-smoke.cjs 覆盖)。
 *
 * 只跑 `tests/**\/*.spec.ts`;`scripts/*.mjs` 属构建脚本,不进测试面。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 每个 spec 独占进程:sqlite/临时目录互不干扰(node:sqlite 的 DatabaseSync 是进程级句柄)
    pool: 'forks',
    reporters: ['default'],
  },
})
