# RC5-ENV-003 — 版本族统一（catalog + 全仓清单）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:92`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:04:26.457Z → 2026-11-19T22:04:26.457Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

全部 dsh 依赖 `0.2.2-rc.5`；`cordis 4.1.0`；`cosmokit 1.9.0`。

## 实际

catalog 中 28 个 `@deepseek-ai/dsh-*` 条目全部 `0.2.2-rc.5`；`@deepseek-ai/cordis=4.1.0`、`@deepseek-ai/cosmokit=1.9.0`。扫描 47 个清单 / 63 条 dsh* spec：旧钉版 0、精确版偏离 0、旧下限 0。

## 断言

- [x] catalog dsh 全族 rc.5
- [x] cordis 4.1.0
- [x] cosmokit 1.9.0
- [x] 清单无旧钉版/偏离

## 备注

- 扫描面豁免 `core/`（vendor 内核）与 `v1/`，与 51/49 口径一致。

## 证据

- `cmd.log`
- `../_suite/verify-rc5-env.json`
