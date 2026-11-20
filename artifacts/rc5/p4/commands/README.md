# T39 命令面验收证据索引（54 §4.6 / 51 §3.12 CMD）

工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`），时间 2026-11-20。
所有浏览器/探针均在**临时 DSH_HOME**（`/tmp`，跑完清理）与 `--port 0` 上执行；未碰生产容器、未改 access 守卫与生产配置。

## 结论总览

| 用例 | 结论 | 证据 |
|---|---|---|
| RC5-CMD-001 `/` 命令面板 | **PASS**（29 行；compact/model 各 1 行；rc.5 首方命令主机目录 6 条） | `RC5-CMD-001/` |
| RC5-CMD-002 执行内置命令 | **PASS**（`/compact` → `No compactable history yet.`；只写 `command/run`+`command/done`，0 条 user message） | `RC5-CMD-002/` |
| RC5-CMD-003 并存/不重复注册 | **PASS**（默认 standard 每预设恰 1 条；注册表同层重名硬拒绝） | `RC5-CMD-003/` |
| RC5-CMD-004 ACP 命令面 | **DEFERRED to W5**（E4 依赖 T31 ⬜；仅静态核对） | `RC5-CMD-004/` |
| T39-MODEL `/model` 回显 | **PASS**（弹层列目录；选中后触发钮回显新模型） | `T39-MODEL/` |
| T39-BOOT 活体命令目录探针 | **PASS**（真 boot，preset=standard，6 命令、无重名、身份正确） | `T39-BOOT/` |
| T39-UNIT 单测 + 包 verify | **PASS**（9/9；包 verify 241/241、oxlint 0、tsc 0） | `T39-UNIT/` |

## 本轮代码改动

| 文件 | 改动 |
|---|---|
| `packages/compaction/src/command-plugin.ts:101-108` | `/compact` 的 `definitionId` 从 `@eterna/compaction/command-plugin` 恢复为上游首方身份 `@deepseek-ai/dsh-command-compact`（修复 `/` 菜单本地化、`/压缩` 别名、SDK `queryCommand` 识别） |
| `packages/compaction/tests/command-plugin.spec.ts`（新增） | 9 用例：注册身份/重名拒绝/无参/委托/结果/六码错误/abort/异常/注销 |

## 一键复跑

```sh
cd /Users/sunny/code/agent-basis-rc5
node_modules/.bin/vitest run --root packages/compaction tests/command-plugin.spec.ts
/opt/homebrew/bin/pnpm --filter @eterna/compaction run verify
node artifacts/rc5/p4/commands/T39-BOOT/run-probe.mjs
DSH_HOME="$PWD/.eterna-home" node node_modules/@deepseek-ai/dsh/lib/bin.js --profile eterna-web --dump-config
node artifacts/rc5/p4/commands/T39-MODEL/run-ui.mjs
```

前置：`.eterna-home/profiles/eterna-web` 已由 `scripts/verify-eterna-web.mjs` 物化；浏览器探针用系统
Google Chrome（`/Applications/Google Chrome.app`）+ `playwright-core`（仓库已装）。

## 脱敏

- `boot.log` / `runtime.log` 中 `token=…` 已替换为 `token=<redacted>`；
- 登录账号为测试用 `cmdprobe`，口令仅进程内存随机生成、未落盘/未回显（`run-ui.mjs` 内变量，无值输出）；
- 临时 home 已清理，未拷贝任何生产凭据。