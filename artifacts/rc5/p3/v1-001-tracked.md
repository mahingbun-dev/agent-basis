# RC5-V1-001 — v1 源全部入库（git ls-files 覆盖）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:278`（RC5-V1-001，P0）
- 任务：T19/T20（54 §4.5、50 §3.3）
- 判定：**PASS**（本 session 实跑）

## 命令原文

```bash
cd /Users/sunny/code/agent-basis-rc5
git ls-files core basis.yml packages/system-prompt packages/session packages/tools \
  packages/llm packages/approval-cli packages/agent-loop
```

## 结果

`EXIT=0`，命中 **94** 个已跟踪文件。按目录分布：

| 分组 | 文件数 |
|---|---|
| `basis.yml` | 1 |
| `core/contracts` | 18 |
| `core/cordis` | 16 |
| `core/runtime` | 14 |
| `packages/agent-loop` | 8 |
| `packages/approval-cli` | 7 |
| `packages/llm` | 8 |
| `packages/session` | 7 |
| `packages/system-prompt` | 7 |
| `packages/tools` | 8 |

原始清单：`artifacts/rc5/p3/v1-git-ls-files.txt`

## 遗漏检测（磁盘 vs 索引）

逐目录比对「磁盘上非 node_modules 文件」与「git 索引」，唯一漏项是 `core/cordis/LICENSE`
（vendor 源码的 MIT 原版权声明，README 第 9 行明确「见 LICENSE」）。

```text
UNTRACKED core/cordis/LICENSE
```

**已修复**（本 lane 可改 `core/**`）：

```bash
git add core/cordis/LICENSE
# git status --porcelain → A  core/cordis/LICENSE
# git ls-files core/cordis/LICENSE → core/cordis/LICENSE
```

修复后复跑逐文件比对，仅剩以下 9 个 `.d.ts`：

```text
UNTRACKED core/cordis/lib/types/{index,context,events,fiber,logger,reflect,registry,service,utils}.d.ts
```

这些是**设计上不入库**的构建产物：`.gitignore:12` 的 `lib/` 规则命中，CI `v1-line` 在测试前
用 `pnpm --filter @core/cordis declarations` 现产（`.github/workflows/ci.yml:175-177`）。
不属于 V1-001 的遗漏。

## 断言

- [x] `core/{cordis,contracts,runtime}` 全部源文件已跟踪
- [x] 六个 `@basis/*` 包全部源文件已跟踪（含 `tests/`、`vitest.config.ts`、`tsconfig.json`）
- [x] `basis.yml` 已跟踪
- [x] `core/runtime/bin/basis.mjs`（CLI 入口）已跟踪
- [x] 磁盘无「应入库而未入库」的源文件（`lib/types` 为 gitignored 生成物，豁免）