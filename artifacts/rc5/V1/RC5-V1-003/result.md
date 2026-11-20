# RC5-V1-003 — core/cordis 版本与 NOTICE

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:280`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:10:13Z → 2026-11-19T22:10:13Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

版本/来源 4.1.0；NOTICE 更新。

## 实际

`core/cordis/package.json` 版本 `4.1.0-basis.1`（本地 vendor 标记），描述声明 vendor 自 `@deepseek-ai/cordis 4.1.0`；README `## NOTICE(vendor 出处与许可)` 记录上游 tag `dsh-v0.2.2-rc.5`、commit、MIT LICENSE；`src/logger.ts` 为 4.1.0 数值序。

## 断言

- [x] 来源 4.1.0（README NOTICE）
- [x] 本地版本 4.1.0-basis.1 属 vendor 线
- [x] LICENSE 保留

## 备注

- 版本号带 `-basis.1` 后缀（本地 vendor 惯例，49 §3 口径），非上游版本偏离。

## 证据

- `cmd.log`
- `check-cordis-version.mjs`
