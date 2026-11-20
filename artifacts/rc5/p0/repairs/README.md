# W0 门禁失败修复（第 1 轮）· 2026-11-20

工作树 `/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`）。
基线 commit `02f4857`（修复全部在工作区，未 commit / 未 push）。

> **第 2 轮追加（本轮）**：第 1 轮的「裸 `--`」修法不足以让门禁通过——第 2 轮门禁输出仍是
> `未知命令: (空)`。已定位真实形状为「runner 在 script 之后、子命令之前注入旗标」，
> 第 2 轮修复与证据见文末 **§8**。第 1 轮已转绿的 `llm-openai typecheck` / `verify-rc5-env`
> 在第 2 轮门禁输出中已消失（即通过），本轮未回退。

## 0. 门禁失败项 → 复跑结果

| # | 门禁命令（原文） | 修复前 | 修复后 EXIT | 证据日志 |
|---|---|---|---|---|
| 1 | `node tools/packctl/bin/packctl.mjs form-check` | `未知命令: (空)` EXIT 2 | 0 | `packctl-form-check.log` / `-plain.log` |
| 2 | `node tools/packctl/bin/packctl.mjs tenant-scan` | `未知命令: (空)` EXIT 2 | 0 | `packctl-tenant-scan.log` |
| 3 | `node tools/packctl/bin/packctl.mjs prompt-scan` | `未知命令: (空)` EXIT 2 | 0 | `packctl-prompt-scan.log` |
| 4 | `pnpm --filter @eterna/llm-openai typecheck` | TS2345 EXIT 2 | 0 | `llm-openai-typecheck.log` |
| 5 | `node scripts/verify-rc5-env.mjs` | 1 PASS / 1 WARN / 3 FAIL，EXIT 1 | 0（4 PASS / 1 WARN / 0 FAIL） | `verify-rc5-env.log` |
| 6 | `node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay` | 只打用法 EXIT 2 | 0（total=30 pass=30 fail=0） | `evals-plain.log` / `evals-event-planning-replay.log` |

补充（非门禁项，顺带的定向验证）：`packctl lint` → 0（2 包，0 error/0 warning）；`node scripts/verify-rc5-env.mjs --api-static` → 0（6 PASS / 1 WARN / 0 FAIL，API-008/009 全绿）。

六条门禁同一轮串联复跑的原始输出与逐条 `EXIT=` 见 `exits.txt`（末行为 `pack=… adapter=replay total=30 pass=30 fail=0`）。

## 1. 根因 A：两个 CLI 把裸 `--` 当旗标吞掉下一个 token（门禁 1/2/3/6）

复现（修复前）：

```
$ node tools/packctl/bin/packctl.mjs -- form-check
未知命令: (空)
packctl —— 领域包脚手架与门禁(...)
EXIT=2
```

机制：`tools/packctl/src/cli.ts` 的 `parseArgs` 对任何 `--` 开头的 token 都走「旗标」分支；
`--` 自身被解析为空名旗标（`key=''`），并把紧随其后的 `form-check` 当作它的值吞掉 →
`command` 为空 → 命中 `default` 分支打印 `未知命令: (空)`（`cli.ts:93`），退出码 2。

`tools/evals/src/cli.ts` 同型：裸 `--` 进 flag 分支，`run` 被当作 `--` 的取值 →
`parseArgs` 返回 `undefined` → 打用法、退出码 2。

修复（两处同构）：裸 `--` 视为选项分隔符直接剔除，其后的 token 照常解析
（`tools/packctl/src/cli.ts:52`、`tools/evals/src/cli.ts:106`），各加一条回归断言
（`tools/packctl/tests/cli.spec.ts:89`、`tools/evals/tests/cli.spec.ts:59`）。

判定依据说明：门禁输出里 `### … form-check` 与工具实际收到的空参数完全一致；同一门禁里
`pnpm --filter @eterna/llm-openai typecheck` 确实收到了参数（跑出了 tsc 错误）——
说明 harness 对 `node <script> <args>` 形态的分发丢了参数。仓库内 CI
（`.github/workflows/ci.yml:46,62,65`）是不带 `--` 的形态、本来就能跑通；`--` 形态是
在该假设下唯一会让两个 CLI 空参的调用形状。若 harness 实际是「整段丢参」而非「前置 `--`」，
则修在 harness 侧，本 lane 无法改（见遗留 L-03）。

## 2. 根因 B：`HTTP_${String(status)}` 退化成 `HTTP_${string}`（门禁 4）

`packages/llm-openai/src/adapter.ts:107` 第二参为 `` `HTTP_${String(response.status)}` ``，
推断成 `` `HTTP_${string}` ``，与上游 `BuiltinLlmFailureCode` 的 `` `HTTP_${number}` `` 分支不兼容：

```
src/adapter.ts(107,9): error TS2345: Argument of type '`HTTP_${string}`' is not assignable to parameter of type 'BuiltinLlmFailureCode'.
```

修复：改裸数值插值 `` `HTTP_${response.status}` ``（`adapter.ts:109`），并加了两行说明注释。
`scripts/verify-rc5-env.mjs` 的 API-008 判定器（`isConstantCode`，`verify-rc5-env.mjs:555`）
明确把 `String()`/`.toString()` 插值列为非法形态，现复跑 API-008 PASS。

## 3. 根因 C：Dockerfile 内核钉版停在 alpha.3（ENV-006/ENV-004/ENV-002）

`Dockerfile:67` 原为 `npm i -g @deepseek-ai/dsh@0.2.2-alpha.3 @deepseek-ai/dsh-mcp-client@0.2.2-alpha.3`。
改为 `… @0.2.2-rc.5 @…-mcp-client@0.2.2-rc.5`，并在上方注释登记口径与保留理由。

- ENV-006：`✓ 全局内核精确 0.2.2-rc.5`、`✓ 有效行无 alpha.* 钉版`；
- ENV-004：`✓ 镜像钉版 = 0.2.2-rc.5(静态)`；
- 剩余 1 条 **WARN**（不阻断）：`全局另装 dsh-mcp-client`。49 号 §4 目标「只装 dsh、
  mcp-client 用宿主内嵌」尚未落地 —— `docker/entrypoint.sh:282-287` 仍从 `npm root -g`
  软链该包，缺失会打穿 mcp-browser 挂载。故保留现役接线，记遗留 L-01。

## 4. 根因 D：ENV-002 非注释版本残留 28 处（+ Dockerfile 1 处已随 C 消除）

替换口径：`0.2.2-alpha.2|rc.1|alpha.3` → `0.2.2-rc.5`；`>=4.0.6-alpha.1` → `>=4.1.0`
（cordis 4.1.0 的 LoggerLevel 数值序已反转，见 51 号 API-009，旧下限不再成立）。

| 文件 | 位置 | 原值 → 新值 |
|---|---|---|
| `market/glue-bundle/package.json` | :17 | `cordis >=4.0.6-alpha.1` → `>=4.1.0` |
| `market/pack-bundle/package.json` | :13 | 同上 |
| `packs/event-planning/package.json` | :13 | 同上 |
| `packs/industrial-analysis/package.json` | :13 | 同上 |
| `packages/access/src/market-publish.ts` | :59（+ 头注 :19） | 缺省 `dshRange '>=0.2.2-alpha.2'` → `'>=0.2.2-rc.5'` |
| `packages/access/tests/market-publish.spec.ts` | :38, :74, :282 | 断言同步 `>=0.2.2-rc.5` |
| `packages/brand/tests/brand.test.ts` | :183 | `DSH 本地构建\n0.2.2-rc.1` → `…0.2.2-rc.5` |
| `packages/browser-relay/smoke/gate-setup.mjs` | :121-122 | `dsh-agent-preset@0.2.2-rc.1` / `dsh-mcp-client@0.2.2-rc.1` → `@0.2.2-rc.5` |
| `scripts/build-market.mjs` | :134, :193 | `cordis >=4.0.6-alpha.1` → `>=4.1.0` |
| `scripts/build-market.mjs` | :135, :136, :194 | `>=0.2.2-alpha.2` → `>=0.2.2-rc.5` |
| `scripts/ps-v2-ai-smoke.mjs` | :83-85 | `0.2.2-rc.1` → `0.2.2-rc.5` |
| `scripts/t7-e2e.mjs` | :139-141 | 同上 |
| `scripts/t7-smoke.mjs` | :113-115 | 同上 |
| `scripts/t7-spike-verify.mjs` | :144-146 | 同上 |

`market/*-bundle/package.json` 是 `scripts/build-market.mjs` 的产物，生成器与产物同步改，避免下次构建回退。

## 5. 定向测试（全部本轮实跑）

| 命令 | EXIT | 结果 |
|---|---|---|
| `npx vitest run tests/cli.spec.ts`（cwd=`tools/packctl`） | 0 | 9/9 通过（含新增 `--` 回归） |
| `npx vitest run tests/cli.spec.ts`（cwd=`tools/evals`） | 0 | 8/8 通过（含新增 `--` 回归） |
| `pnpm --filter @eterna/packctl typecheck` | 0 | 无输出 |
| `pnpm --filter @eterna/evals typecheck` | 0 | 无输出 |
| `npx vitest run --root packages/access tests/market-publish.spec.ts` | 0 | 11/11 通过 |
| `npx vitest run --root packages/brand tests/brand.test.ts` | 0 | 17/17 通过 |
| `pnpm --filter @eterna/llm-openai test` | 0 | 14/14 通过（2 文件） |
| `pnpm install --frozen-lockfile --ignore-scripts` | 0 | `Already up to date`（peer 区间变更未破坏锁文件；注意：加了 `--ignore-scripts`，未跑原生构建脚本） |

## 6. 未执行 / 不在本轮范围

- 容器内 `dsh --version`（ENV-004 运行时半）：需 P5 镜像，本轮未构建、未运行；
  报告中的 ENV-004 仅为静态代理项（脚本自述 `runtime=not-run`）。
- `dsh-evals` 的 `--adapter acp` 路径：需 Python SDK/driver，本轮只跑 `replay`。
- 全量 CI（`pnpm install` + oxlint + 全仓 tsc + 全仓 vitest）：未跑；本轮只跑上述定向项。
- 未 commit / 未 push / 未动容器。

## 7. 遗留

- L-01｜ENV-006 WARN：镜像仍全局装 `dsh-mcp-client`（49 §4 目标为宿主内嵌）｜低｜
  先落 `entrypoint.sh` 的宿主内嵌接线再删全局包，否则 mcp-browser 挂载失效。
- L-02｜ENV-002 informational：90 条注释 + 278 文档 + 8 清单 description 仍含历史版本叙述（不计门禁）｜信息｜收尾统一清理。
- L-03｜门禁 harness 调用形态：第 2 轮已把「script 之后注入任意旗标」与「参数串合并成单 token」
  两种形状都兜住（§8），普通/`--`/注入旗标三种形状本地均 EXIT 0｜中｜若第 3 轮仍报
  `未知命令: (空)`，看诊断里的 `argv 数量=`：为 0 即 runner 整段丢参（只能修 runner 侧）。

## 8. 第 2 轮：runner 注入旗标吞掉子命令（真实根因）

### 8.1 证据链

1. 第 1 轮改动仍在（`tools/packctl/src/cli.ts` 裸 `--` 剔除、`tools/evals/src/cli.ts` 同型），
   手工复跑 `node tools/packctl/bin/packctl.mjs form-check` 与 `… -- form-check` 均 EXIT 0。
2. 第 2 轮门禁只剩 4 条失败，全是 `node <script> <subcommand>` 形态；已转绿的两条是
   `pnpm --filter … typecheck`（pnpm 收到参数）与 `node scripts/verify-rc5-env.mjs`（无参数）。
3. 复现实验（本轮实跑）：

```
$ node tools/packctl/bin/packctl.mjs --experimental-strip-types form-check
未知命令: (空)
packctl —— 领域包脚手架与门禁(06 号 SOP 模板 / G0 lint)
EXIT=2

$ node tools/evals/bin/dsh-evals.mjs --experimental-strip-types run --pack packs/event-planning
用法: dsh-evals run --pack <目录> [选项]
```

   与门禁输出逐字一致。机制：runner 把 node 旗标插在 **script 之后**，旧解析把任何
   `--flag` 都当「取值旗标」，把紧随的子命令（`form-check` / `run`）当成它的取值吞掉，
   `command` 落空。两个 shim 都 `import ../src/cli.ts`（`packctl.mjs:5`、`dsh-evals.mjs:5`），
   是门禁里唯一需要 TS strip-types 的两条 → 与「只在需要 strip-types 时注入该旗标」吻合。

### 8.2 修复

- `tools/packctl/src/cli.ts:44-135`、`tools/evals/src/cli.ts:100-211`：
  - 新增命令白名单 + 取值旗标白名单；
  - **序言切分** `splitPrologue`：定位第一个已知子命令，其前 token 按 runner 序言丢弃
    （其中已知取值旗标仍收下）；序言只在「子命令前确有旗标」时成立，正常调用行为不变；
  - 未知旗标一律不消费下一个 token；整串参数被塞进单 token 时摊平；
  - 诊断：命令落空时打印 `argv 数量=N`（只打印个数，防凭据入日志）。
- 回归用例：`tools/packctl/tests/cli.spec.ts:96-110`、`tools/evals/tests/cli.spec.ts:66-74`。

### 8.3 形状矩阵（本轮实跑，全部 EXIT 0）

| 形状 | packctl | evals |
|---|---|---|
| 正常 `form-check` / `run --pack …` | 0 | 0 |
| 裸 `--` 前置 | 0 | 0 |
| 注入 `--experimental-strip-types` | 0 | 0 |
| 注入「带值」旗标 `--cwd /tmp` / `--import /x/n.mjs` | 0 | 0 |
| 整串塞进单 token（`"-- form-check"` / `"run --pack …"`） | 0 | 0 |
| 未知命令 `frobnicate` / `dance` | 2（`未知命令: frobnicate`） | 2（`未知命令: dance`） |
| 无参数（runner 整段丢参时才会出现） | 2（`未知命令: (空)(argv 数量=0)`） | 2（`参数解析失败(argv 数量=0)`） |

原始输出：`exits-r2.txt`（门禁六条原文）、`exits-injected-flag.txt`（注入形状）。

### 8.4 第 2 轮定向测试

| 命令 | EXIT | 结果 |
|---|---|---|
| `npx vitest run tests/cli.spec.ts`（cwd=`tools/packctl`） | 0 | 11/11 |
| `npx vitest run tests/cli.spec.ts`（cwd=`tools/evals`） | 0 | 9/9 |
| `pnpm --filter @eterna/packctl verify`（oxlint + tsc + 全包 vitest） | 0 | 10 文件 / 108 tests 全过 |
| `pnpm --filter @eterna/evals verify`（oxlint + tsc + vitest + python unittest） | 0 | 10 文件 / 99 tests + 19 python tests 全过 |
| `pnpm --filter @eterna/packctl typecheck` | 0 | 通过 |
| `pnpm --filter @eterna/evals typecheck` | 0 | 通过 |
| `packctl init legal --root /tmp/pct` → `lint` → `check` | 0/0/0 | 正常路径未回归 |
| 六条门禁串联（`exits-r2.txt`，普通形态 + `--experimental-strip-types` 注入形态各一遍） | 0 | 10/10 全绿 |

> 注：oxlint `@stylistic(max-len)` 曾把 `splitPrologue` 的返回类型签名报 144>140，已改为命名
> `interface Prologue`；`packctl verify`/`evals verify` 的绿即由此复跑得出。