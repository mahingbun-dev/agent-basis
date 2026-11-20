# RC5-UI-007 — MCP 作为设置分区

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:312`（优先级 P1 / 方式 S）
- 执行时间：2026-11-19T22:19:04Z → 2026-11-19T22:19:04Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

MCP 作为 `settings.section`；无独立页面入口。

## 实际

`packages/access/src/client/index.tsx:428-438` 通过 `ctx.slots.inject('settings.section')` 注册 id `${NS}.mcp-servers`，组件 `McpServersSection` 带 `data-eterna-settings-section="mcp-servers"`；`routes.ts` 无任何 mcp 页面路由（仅 logout 注释提及个人 MCP）。

## 断言

- [x] MCP 注册为 settings.section
- [x] 无独立 MCP 页面路由

## 备注

- UI 形态截图属 UI-006（E2），本 lane 未做。

## 证据

- `cmd.log`
- `../_suite/scope.txt`
- `../_suite/ui-scan.mjs`
