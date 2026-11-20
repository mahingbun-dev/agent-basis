# RC5-API-009 — LoggerLevel 数值语义（静态 + 真行为）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:129`（P2 / S / 日志）
- 执行时间：2026-11-19T22:43:46Z（行为，两套 cordis）→ 2026-11-19T22:46:35Z（静态复核）
- 环境：宿主 `@core/cordis`（vendored，运行时导出常量）+ 3108 容器内上游 `@deepseek-ai/cordis 4.1.0`
- 命令与退出码：见 `cmd.log`（静态 `STATIC_EXIT=0`；行为 `HOST_EXIT=0` / `UPSTREAM_EXIT=0`）
- 判定：**PASS**

## 预期

触发 debug/info/warn；级别显示正确（rc.5 数值语义）。

## 实际

### 1. 静态复核（本 session 重跑）

`node scripts/verify-rc5-env.mjs --api-static` → **EXIT 0**，API-009 六项全过：

- vendor `LoggerLevel = {ERROR:0, WARN:1, INFO:2, DEBUG:3}`
- 构建产物 `LoggerLevel` 同值
- 阈值缺省用 `LoggerLevel.INFO` 符号（非字面量 2），`logger.ts:159`
- 过滤方向 `targetLevel < level`，`logger.ts:160`
- 全仓日志级别数值比较 2 处，全部在登记簿
- 登记簿无失效条目

### 2. 行为验证（上游 4.1.0，3108 容器）

`api009.mjs` 在真实 `Context` 上注册四档阈值 exporter（0/1/2/3），触发
`error/warn/info/debug` 四档消息，**10/10** 检查通过，`ok=true`：

| 阈值 | 实际收到 |
|---|---|
| 0 | error |
| 1 | error + warn |
| 2 | error + warn + info |
| 3 | error + warn + info + debug |

- 四档消息的 `level` 数值：`error=0, warn=1, info=2, debug=3`。
- 名称级覆盖：`levels={'api-009':3, default:0}` 时 `api-009` 收到四档，另一个 logger `other` 只收到 error。
- `LoggerOptions.level=WARN` 的 logger 只输出 `error+warn`。
- 方向验证：阈值 0 仍收到 `error`（因 `0 < 0` 不成立，不跳过），确认是 `targetLevel < level ⇒ skip`。
- 上游 4.1.0 的 `LoggerLevel` 是 **`const enum`**（运行时无导出，`loggerLevelExport=false`）；脚本用 d.ts 钉住的数值常量做回退，行为断言全部按数值执行。

### 3. 行为验证（vendored @core/cordis，宿主）

同一脚本，`loggerLevelExport=true`，**10/10** 通过，`ok=true`；数值与过滤方向与上游一致。

## 断言

- [x] `ERROR=0 / WARN=1 / INFO=2 / DEBUG=3`（数字越大越 verbose）
- [x] 阈值 0/1/2/3 分别只显示 error / +warn / +info / +debug
- [x] 四档消息的 level 数值正确
- [x] `LoggerOptions.level` 与 exporter 名称级覆盖语义正确
- [x] 过滤方向 `targetLevel < level` 正确
- [x] vendored 与上游 4.1.0 行为一致（各 10/10）

## 备注

- 本用例的“级别显示”按 logger/exporter 阈值过滤语义验证（51 用例语境），不是 UI 面板渲染；UI 侧无本用例断言项。
- 上游 `const enum` 无运行时导出是 4.1.0 的既定形态，不是缺陷；若后续代码需要运行时枚举，需自行落常量。记为 leftover `API009-CONSTENUM`（P3，文档性）。
- 未使用模型/凭据；本节不涉及 stub 局限。

## 证据

- `cmd.log` — 命令原文与 EXIT
- `../_harness/api009/api009-static.log` / `api009-static.json` — 静态复核
- `../_harness/api009/api009-upstream-4.1.0.log` — 上游 4.1.0 行为，10/10
- `../_harness/api009/api009-vendored-host.log` — vendored 行为，10/10
- `../_harness/api009.mjs` — 行为测试脚本（可复现）