# RC5-UI-005 — 新增 UI 断点检查

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:310`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:19:04Z → 2026-11-19T22:19:04Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

只有 1100/760/640。

## 实际

7 处宽度媒体查询：760/760/760/640（access）+ 1100/760/640（brand）；无 matchMedia；无其它宽度断点。组件 min-width/max-width（如表格 560px、`min()`）不计为断点。

## 断言

- [x] 断点仅 1100/760/640
- [x] 无越界 matchMedia

## 证据

- `cmd.log`
- `../_suite/scope.txt`
- `../_suite/ui-scan.mjs`
