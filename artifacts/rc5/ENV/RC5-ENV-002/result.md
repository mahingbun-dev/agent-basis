# RC5-ENV-002 — 全仓版本残留扫描（alpha.2/alpha.3/rc.1）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:91`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:04:26.457Z → 2026-11-19T22:04:26.457Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

扫 `0.2.2-alpha.2|alpha.3|rc.1`（排除历史文档/锁文件），命中 0。

## 实际

`scripts/verify-rc5-env.mjs` 扫描 1773 个文本文件：非注释命中 0（硬门禁 PASS）；扫描面不含 `.secrets/.env*`；规则自检 19/19 通过。信息面：80 条注释 + 276 条文档 + 8 条清单 description + 2 条裸 `rc.1`，均不计门禁。

## 断言

- [x] 硬门禁残留 0
- [x] 扫描面不含凭据文件
- [x] 规则自检 19/19

## 备注

- WARN 仅信息面：`docs/`、`plans/`、注释与清单 description 中的历史叙述按 51 号明文排除。

## 证据

- `cmd.log`
- `../_suite/verify-rc5-env.json`
