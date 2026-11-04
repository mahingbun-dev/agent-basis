/**
 * node --test 目录参数兼容垫片(纯聚合,零断言)。
 *
 * 背景:Node v24.18.0 的 `node --test <目录>` 位置参数不递归发现测试文件,
 * 而是把目录当主模块加载(MODULE_NOT_FOUND)。本文件经 tools/package.json
 * 的 main 指向,使 `node --test packs/event-planning/tools` 这种目录形态
 * 也能真实执行全部 *.test.mjs(失败照常传播,见下)。
 *
 * 两种跑法等价(同一批 40 个用例):
 *   node --test tools/*.test.mjs   # glob 直接发现
 *   node --test tools              # 目录参数 → package.json main → 本垫片
 */
await import('./budget-tool.test.mjs')
await import('./schedule-tool.test.mjs')
await import('./template-tool.test.mjs')
await import('./approval-tool.test.mjs')
await import('./guard-tool.test.mjs')
await import('./vendor-registry.test.mjs')
