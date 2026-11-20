# T19/T20 — v1 门禁证据索引（RC5-V1-001..007）

- 任务来源：`docs/design/54-rc.5开发与测试验收完整workflow.md:356`（T19/T20，P3/L3）
  与 `:362`；`docs/design/50-上游rc.5合并开发落地文档.md:184`（§3.3 WP3）
- 用例定义：`docs/design/51-上游rc.5合并测试用例与回归.md:278-284`
- 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`）
- 执行日期：2026-11-20

## 逐条结论

| 用例 | 级别 | 判定 | 证据文件 | 关键命令 / EXIT |
|---|---|---|---|---|
| V1-001 入库覆盖 | P0 | **PASS**（修复 1 处：补 track `core/cordis/LICENSE`） | `v1-001-tracked.md` | `git ls-files …` → 94 文件，EXIT=0 |
| V1-002 锁文件 | P0 | **PASS** | `v1-002-lock.md` | 9 importer + `pnpm install --frozen-lockfile` → EXIT=0 |
| V1-003 cordis 版本/来源 | P0 | **PASS** | `v1-003-cordis-revendor.md` | `4.1.0-basis.1`；上游 rc.5 tag 实读；LICENSE sha256 同源 |
| V1-004 cordis 测试 | P0 | **PASS** | `v1-004-cordis-test.md` | `pnpm --filter @core/cordis test` → 5/5，EXIT=0 |
| V1-005 runtime + chat | P0 | **PASS** | `v1-005-runtime-cli.md` | runtime 13/13；chat EXIT=0；六服务 present |
| V1-006 v1 CI 车道 | P1 | **部分**：job 定义+本地等价全绿；Actions 实跑 **NOT RUN**（分支未推送） | `v1-006-ci-line.md` | 12 步本地等价全 EXIT=0 |
| V1-007 无 dsh 依赖 | P1 | **PASS** | `v1-007-no-dsh.md` | grep 零命中（EXIT=1）；仅 cosmokit/standard-schema |

## 测试总量（本 session 实跑）

| 范围 | 文件 | 用例 | EXIT |
|---|---|---|---|
| `@core/cordis` | 1 | 5 | 0 |
| `@core/contracts` | 1 | 3 | 0 |
| `@core/runtime` | 2 | 13 | 0 |
| `@basis/system-prompt` | 1 | 5 | 0 |
| `@basis/session` | 1 | 4 | 0 |
| `@basis/tools` | 1 | 8 | 0 |
| `@basis/llm` | 1 | 5 | 0 |
| `@basis/approval-cli` | 1 | 6 | 0 |
| `@basis/agent-loop` | 1 | 7 | 0 |

（v1 合计 35 tests；六插件合计 35 tests）

## 全仓 verify（T20 交付定义 `pnpm -r verify`）

```bash
pnpm -r verify    # EXIT=0；38 个定义 verify 的 workspace 项目全绿
```

日志 `v1-pnpm-r-verify.log`（68 KB）。日志中的 `[FAIL]`/`[SCHEMA-FAIL]` 行来自
`tools/evals` 的**故障夹具输出**（该测试本身在验证失败判定路径），非 verify 失败。

## 本 lane 的改动

| 文件 | 动作 |
|---|---|
| `core/cordis/LICENSE` | `git add`（此前未跟踪，vendor 版权声明缺位） |
| `artifacts/rc5/p3/v1-*` | 新增证据（40 个文件：8 份 md + 32 份原始日志/清单） |

未改任何源码；`basis.yml`、六个 `@basis/*` 包、`ci.yml` 的 `v1-line` job 保持原样
（`ci.yml` 的未提交 diff 仅是本 lane 已有的 v1-line 追加 91 行，无其它 lane 内容）。

## 未完成项

- **V1-006 的 GitHub Actions 实跑**：`feat/dsh-rc5-merge` 未推送（`git ls-remote` 无此分支），
  硬边界禁止 push；需在 T54 推送后由 CI 复跑确认。本地已逐条对齐 12 步。