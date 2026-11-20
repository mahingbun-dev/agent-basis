# RC5-UI-004 — 新增 UI 图标检查

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:309`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:19:04Z → 2026-11-19T22:19:04Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

`@eterna/ui/icons`/`icon-data`，无 emoji/手写 SVG。

## 实际

4 处图标导入全部来自 `@eterna/ui/icons` 或 `@eterna/ui/icon-data`；0 处 emoji；0 处上游图标包导入；1 处内联 `<svg>` 为 brand `FAVICON_SVG` 数据 URI（brand/index.ts:36，品牌资产豁免）。

## 断言

- [x] 图标走 @eterna/ui
- [x] 无 emoji 功能图标
- [x] 无上游图标/一次性手写 SVG（品牌 favicon 除外）

## 备注

- favicon SVG 属 AGENTS.md 品牌插画/图标资产豁免。

## 证据

- `cmd.log`
- `../_suite/scope.txt`
- `../_suite/ui-scan.mjs`
