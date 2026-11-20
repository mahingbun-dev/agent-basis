# RC5-V1-006 — v1 独立 CI 车道（`v1-line`）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:283`（RC5-V1-006，P1：
  「v1 CI 车道 | 独立 job 绿；不依赖 dsh 安装」）
- 任务：T20（54 §4.5「CI v1-line 实跑」；54 §4.2 R16 明确「v1 CI 实际运行」缺证据）
- 判定：**部分通过 — job 定义与本地等价命令全绿；GitHub Actions 实跑 NOT RUN**

## 1) job 定义（`.github/workflows/ci.yml` 实读 + YAML 解析）

```bash
python3 -c "import yaml; m=yaml.safe_load(open('.github/workflows/ci.yml')); ..."
```

```text
jobs: verify,daily-boot-gate,upgrade-gate,v1-line
v1-line.if: github.event_name != 'schedule'
v1-line.needs: (none)
v1-line.steps: 12
  - actions/checkout@v4
  - v1 范围检测(PR 按改动过滤;push 恒跑)
  - pnpm/action-setup@v4
  - actions/setup-node@v4
  - Install(与主 verify 同锁)
  - cordis 声明出口(lib/types,gitignored)
  - cordis vendor typecheck + smoke(RC5-V1-003/004)
  - contracts/runtime typecheck + test(RC5-V1-005)
  - 六插件 typecheck + test
  - v1 源不依赖产品线 dsh 包(RC5-V1-007)
  - basis.yml 六插件装载冒烟(chat EOF 退出;V1-005)
  - basis CLI 单 turn 冒烟(stub fixture)
```

（`artifacts/rc5/p3/v1-ci-parse.txt`；job 体在 `.github/workflows/ci.yml:129-218`）

「独立」与「不依赖 dsh 安装」的实读证据：

- `v1-line` 无 `needs:`，与 `verify`/`daily-boot-gate`/`upgrade-gate` 并行，互不阻塞；
- 12 步中无任何 `npm i @deepseek-ai/dsh` / `pnpm add` / 镜像构建；安装只有
  `pnpm install --frozen-lockfile`（`:169-171`），装的是本仓 workspace 依赖；
- 不读 `docker/profile`、不启动容器、不依赖 `DSH_HOME`。

## 2) 路径过滤（fail-open）

`.github/workflows/ci.yml:142-158`：PR 用 `git diff --name-only origin/${BASE_REF}...HEAD`
比对正则；`push` 恒 `match=true`；diff 失败注入 `__diff_failed__` 走 fail-open（不静默跳过）。

本地用本次分支实跑该判定：

```bash
git diff --name-only origin/main...HEAD | wc -l      # → 130
grep -Eq '^(core/|basis\.yml$|packages/(system-prompt|session|tools|llm|approval-cli|agent-loop)/|…)' <diff>
# → match=true
```

（`artifacts/rc5/p3/v1-scope-diff.txt`）

## 3) 本地等价命令（逐步对齐 job）

| CI 步骤 | 本地等价命令 | EXIT | 日志 |
|---|---|---|---|
| Install | `pnpm install --frozen-lockfile` | 0 | `v1-install-frozen.log` |
| cordis 声明出口 | `pnpm --filter @core/cordis declarations` | 0 | `v1-cordis-declarations.log` |
| cordis typecheck | `pnpm --filter @core/cordis typecheck` | 0 | `v1-cordis-typecheck.log` |
| cordis test | `pnpm --filter @core/cordis test` | 0（5/5） | `v1-cordis-test-after-decl.log` |
| contracts typecheck+test | `pnpm --filter @core/contracts {typecheck,test}` | 0 / 0（3/3） | `v1-contracts-*.log` |
| runtime typecheck+test | `pnpm --filter @core/runtime {typecheck,test}` | 0 / 0（13/13） | `v1-runtime-*.log` |
| 六插件 typecheck | `pnpm --filter ./packages/<d> typecheck` ×6 | 全 0 | `v1-basis-<d>-typecheck.log` |
| 六插件 test | `pnpm --filter ./packages/<d> test` ×6 | 全 0（35 tests） | `v1-basis-<d>-test.log` |
| dsh 依赖断言 | `grep -RIn --include='*.ts' --include='*.mjs' '@deepseek-ai/dsh' …` | 1（无命中=PASS） | `v1-dsh-grep.log` |
| chat 冒烟 | `node core/runtime/bin/basis.mjs chat --bundle basis.yml </dev/null` | 0 | `v1-basis-chat.log` |
| run 冒烟 | `node core/runtime/bin/basis.mjs run "ping" --bundle core/runtime/tests/fixtures/basis-run.yml --json` | 0 | `v1-basis-run.json` |

六插件 test 明细：system-prompt 5、session 4、tools 8、llm 5、approval-cli 6、agent-loop 7（合计 35）。

## 4) GitHub Actions 实跑 — **未执行**

```bash
git ls-remote --heads origin feat/dsh-rc5-merge    # → 无输出(分支未推送)
gh run list --workflow=ci.yml --limit 8            # → 最近 8 次均为 main / 其它分支
```

`feat/dsh-rc5-merge` 未推送，因此 GitHub 上没有该分支的 CI 记录；硬边界禁止 `git push`，
本 lane 无法产生真实 Actions 运行。**「独立 job 绿」只在本地等价命令层面成立**，
远端绿灯需推送后由 CI 复跑（留给 T54「CI 全绿（含 v1-line）」）。

## 断言

- [x] `v1-line` 是独立 job（无 `needs`），12 步覆盖 V1-003/004/005/007
- [x] 安装链只做 `pnpm install --frozen-lockfile`，无 dsh 安装、无镜像构建
- [x] 路径过滤在本地实测 `match=true`（fail-open 生效）
- [x] 12 步本地等价命令全部 EXIT=0
- [ ] GitHub Actions 上 `v1-line` 实跑绿灯 — **NOT RUN**（分支未推送；推送属 T54）