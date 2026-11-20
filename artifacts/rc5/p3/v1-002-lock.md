# RC5-V1-002 — 锁文件覆盖全部 `@basis/*` / `@core/*`

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:279`（RC5-V1-002，P0）
- 任务：T19/T20（54 §4.5、50 §3.3「`pnpm-lock.yaml` 含全部 `@basis/*`/`@core/*`」）
- 判定：**PASS**（本 session 实跑）

## 命令原文

### 1) importer 段存在性

```bash
cd /Users/sunny/code/agent-basis-rc5
grep -n "^  \(core\|packages\)/\(cordis\|contracts\|runtime\|system-prompt\|session\|tools\|llm\|approval-cli\|agent-loop\):" pnpm-lock.yaml
```

命中 9 条 importer（`pnpm-lock.yaml`）：

| 行号 | importer | 包名（`package.json` 实读） |
|---|---|---|
| 156 | `core/contracts` | `@core/contracts` |
| 172 | `core/cordis` | `@core/cordis` |
| 191 | `core/runtime` | `@core/runtime` |
| 253 | `packages/agent-loop` | `@basis/agent-loop` |
| 278 | `packages/approval-cli` | `@basis/approval-cli` |
| 752 | `packages/llm` | `@basis/llm` |
| 990 | `packages/session` | `@basis/session` |
| 1009 | `packages/system-prompt` | `@basis/system-prompt` |
| 1105 | `packages/tools` | `@basis/tools` |

### 2) 包名 ↔ importer 机器校验

```bash
node -e "<读 pnpm-lock.yaml importer 名 + 各 package.json 的 name,逐条比对>"
# 脚本见下方输出;完整产物 artifacts/rc5/p3/v1-lock-check.txt
```

输出（全 9 条 OK，`ALL=PASS`）：

```text
OK   packages/system-prompt name=@basis/system-prompt lockImporter=true
OK   packages/session name=@basis/session lockImporter=true
OK   packages/tools name=@basis/tools lockImporter=true
OK   packages/llm name=@basis/llm lockImporter=true
OK   packages/approval-cli name=@basis/approval-cli lockImporter=true
OK   packages/agent-loop name=@basis/agent-loop lockImporter=true
OK   core/cordis name=@core/cordis lockImporter=true
OK   core/contracts name=@core/contracts lockImporter=true
OK   core/runtime name=@core/runtime lockImporter=true
workspace has core/*: true
workspace has packages/*: true
ALL=PASS
```

### 3) workspace 链接（`workspace:*` → `link:`）

`pnpm-workspace.yaml:7` 的 `core/*` 与 `:3` 的 `packages/*` 使九个包成为 workspace 成员；
依赖以 `workspace:*` 声明并被 lock 固定为相对 `link:`：

- `core/contracts` → `@core/cordis` `specifier: workspace:*` / `version: link:../cordis`（157-160）
- `core/runtime` → `@core/{contracts,cordis}` `link:../contracts` / `link:../cordis`（193-198）
- `packages/agent-loop` → `@basis/{llm,tools}` `link:../llm` / `link:../tools`（255-260）
- `packages/{approval-cli,llm,session,system-prompt,tools}` → `@core/{contracts,cordis}` `link:../../core/*`

实际软链已建立（`ls -l` 实读）：

```text
core/runtime/node_modules/@core:   contracts -> ../../../contracts, cordis -> ../../../cordis
packages/agent-loop/node_modules/@basis: llm -> ../../../llm, tools -> ../../../tools
```

### 4) 冻结安装

```bash
pnpm install --frozen-lockfile
# → Scope: all 40 workspace projects / Already up to date / Done in 186ms using pnpm v11.7.0
# EXIT=0       日志 artifacts/rc5/p3/v1-install-frozen.log
```

`--frozen-lockfile` 通过 = 锁与各 `package.json` 声明一致（无 drift）。

## 断言

- [x] 9 个 workspace 包在 `pnpm-lock.yaml` 均有独立 importer 段
- [x] importer 目录名与 `package.json` 的 `name` 一一对应
- [x] 跨包依赖全部为 `workspace:*` → `link:`，无 registry 回落
- [x] `pnpm install --frozen-lockfile` EXIT=0（CI `v1-line` 同款安装步骤）