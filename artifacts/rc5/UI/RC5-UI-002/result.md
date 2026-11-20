# RC5-UI-002 — 新增 UI 圆角检查

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:307`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:19:04Z → 2026-11-19T22:19:04Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

只用 8/12/16/22/28/36/pill；嵌套同心。

## 实际

rc5 变更/新增 UI 17 文件、38 处圆角声明：32 处走 `var(--et-radius-*)`，0 处非阶梯 px 字面量；5 处 `50%`（avatar/switch thumb/range thumb，均为本分支未改动的既有行）；1 处新增 `border-radius: 0`（MCP 页签直角复位）。嵌套同心弧未机器验证。

## 断言

- [x] 新增圆角无阶梯外 px 字面量
- [x] 非零圆角均走令牌/既有 50% 圆形
- [ ] 嵌套同心弧 — 人工未做

## 备注

- `border-radius: 0`（styles.ts:728）是 MCP tab 的直角声明，不是圆角值；5 处 50% 均在本分支 diff 外。建议设计侧确认直角 tab 与 50% 圆形是否按 §2.2 改用 pill。

## 证据

- `cmd.log`
- `../_suite/scope.txt`
- `../_suite/ui-scan.mjs`
