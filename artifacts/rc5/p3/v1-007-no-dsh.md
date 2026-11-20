# RC5-V1-007 — v1 源不依赖产品线 dsh 包

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:284`（RC5-V1-007，P1：
  「grep v1 源 | 无 `@deepseek-ai/dsh` import」）
- 任务：T20（54 §4.5；CI 同名步骤 `.github/workflows/ci.yml:202-210`）
- 判定：**PASS**（本 session 实跑）

## 命令原文（与 CI 步骤逐字一致）

```bash
cd /Users/sunny/code/agent-basis-rc5
grep -RIn --include='*.ts' --include='*.mjs' '@deepseek-ai/dsh' \
  core packages/system-prompt packages/session packages/tools \
  packages/llm packages/approval-cli packages/agent-loop
```

## 结果

无任何命中：`EXIT=1`（grep 语义 = 未找到），日志 `artifacts/rc5/p3/v1-dsh-grep.log` 为 **0 行**。
CI 的判定体是 `if grep … ; then exit 1; fi`，未命中即通过。

## 反向核验：v1 源里到底 import 了哪些 `@deepseek-ai/*`

```bash
grep -Rhno "@deepseek-ai/[a-z0-9-]*" --include='*.ts' --include='*.mjs' \
  core packages/{system-prompt,session,tools,llm,approval-cli,agent-loop} \
  | sed 's/.*@deepseek-ai/@deepseek-ai/' | sort | uniq -c
```

```text
 360 @deepseek-ai/cosmokit
```

唯一命中是 `@deepseek-ai/cosmokit`（cordis 的运行时依赖，CI 注释已白名单：
`.github/workflows/ci.yml:208`「白名单:cosmokit/standard-schema」），另有
`@standard-schema/spec`（`core/cordis/package.json` dependencies）。两者均为独立小包，
不是产品线 `@deepseek-ai/dsh*`。

## 依赖声明面（package.json）

```bash
grep -rn '"@deepseek-ai/dsh' core/*/package.json packages/{…}/package.json
# 无命中,EXIT=1
```

九个 v1 包的 `dependencies` 只含 `@core/*`、`@basis/*`（`workspace:*`）、
`@deepseek-ai/cosmokit`、`@standard-schema/spec`、`yaml`。

## 断言

- [x] `@deepseek-ai/dsh` 在 v1 源（`core/**` + 六个 `@basis/*`）**零命中**
- [x] `package.json` 依赖面同样零 `@deepseek-ai/dsh*`
- [x] 实际外引仅 `cosmokit` / `standard-schema`，落在 CI 白名单内
- [x] 与 CI 步骤 `.github/workflows/ci.yml:202-210` 同命令、同判定