# RC5-SEC-001 — 运行态目录/凭据入库扫描

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:319`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:05:37Z → 2026-11-19T22:05:37Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

`git ls-files` + grep `.eterna-*home*`/`.secrets`/`.env`：无运行态目录、凭据入库。

## 实际

跟踪文件中唯一命中 `.env` 模式的是根 `.env.example`（空值占位样例）；无 `.secrets/`、`.eterna-home*` 跟踪。`.gitignore` 明确忽略 `.secrets/`（:35）、`.env`/`.env.*`（:2-3）、`/.eterna-home*/`（:49）。

## 断言

- [x] 无运行态目录入库
- [x] 无凭据文件入库（仅空样例 .env.example）

## 备注

- .env.example 中密钥字段全部为空占位（DEEPSEEK_API_KEY= 等）。

## 证据

- `cmd.log`
- `.env.example`
