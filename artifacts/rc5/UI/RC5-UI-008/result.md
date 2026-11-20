# RC5-UI-008 — 叠层 z-index 检查

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:313`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:19:04Z → 2026-11-19T22:19:04Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

只允许 1/40/100/200/1000/1100/1500；唯一例外 hero 品牌层 `-1`；决策/toast/通知不同区。

## 实际

z-index 声明 4 处：`1`（pending 点，styles.ts:153）、`100`（账户菜单，styles.ts:417）、`-1` ×2（brand hero 装饰层，brand/styles.ts:25/29，注释记录 `isolation:isolate` 契约）。决策层注册在 `conversation.input.overlay`；通知中心为 `settings.section` id `${NS}.notifications`；未发现自建 toast（走宿主 toast）。

## 断言

- [x] z-index 全在允许表（含 hero -1）
- [x] 决策层走输入卡 overlay
- [x] 通知中心在设置分区
- [x] 无自建 toast

## 备注

- hero `-1` 为 51 号明文唯一例外，brand/styles.ts:24-29 有宿主契约注释。

## 证据

- `cmd.log`
- `../_suite/scope.txt`
- `../_suite/ui-scan.mjs`
