# T21 / B2 品牌 skills 重放 — 证据与结论

- 任务：T21 B2 brand skills（54 §4.5；50 WP3-1）
- 工作树：`<HOME>/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`）
- 基线：上游 tag `dsh-v0.2.2-rc.5`（commit `9c2670d3bc`）的
  `packages/preset/agent-preset/skills/dsh-doc`，共 **43 文件**
  （1 `SKILL.md` + **16 references** + 26 templates）
- 上游仓库路径在证据中写作 `<UPSTREAM>`；本地路径按脱敏约定写作 `<HOME>`。

## 1. 重放结果

| 指标 | 结果 |
|---|---|
| 上游基线文件 | 43（逐路径一一对齐，缺失 0） |
| 品牌 fork 文件 | 46 = 43 上游 + 3 本部署增量 |
| references | 17 = 16 上游 references + 1 增量 `personal-tools.md` |
| 品牌替换 | `DeepSeek Harness (DSH)` 1 处、`DeepSeek Harness` 73 处、裸 `DSH` 18 处 → `EternaAgent` |
| 逐字校验 | 43 文件中 41 个与「基线 + 替换表」逐字一致；2 个仅多出已登记的部署增量段 |
| 品牌扫描 | `DeepSeek Harness` 0；裸 `DSH` 品牌词 0；`@deepseek-ai/*` 保留 303 处 |

替换表（沿用 2026-11-09 品牌替换表）：

1. `DeepSeek Harness (DSH)` → `EternaAgent`（避免出现 “EternaAgent (EternaAgent)”）
2. `DeepSeek Harness` → `EternaAgent`
3. 裸 `DSH`（词位边界）→ `EternaAgent`
4. 保留：`@deepseek-ai/*` 包名、`DSH_HOME` / `DSH_PROFILE` / `DSH_PROFILE_DIR` /
   `DSH_INSTALL_DIR` / `DSH_NODE_EXECUTABLE` / `DSH_*` / `__DSH_BOOT__` 运行时标识符、
   小写 `dsh`（CLI 命令与 `dsh-*` 包名）、以及裸 `Harness`（非品牌扫描词）。
5. 冠词修正：`a EternaAgent` → `an EternaAgent`（4 处，替换后的语法残渣）。

## 2. 目录结构决策

- 上游 rc.5 把 alpha.3 的 **4 skill / 33 文件替换为 1 skill / 43 文件（`dsh-doc`）**；
  `packages/brand/skills` 的旧 4 个目录是纯 alpha.3 上游内容的品牌化 fork
  （47 §2.6：非品牌差异 0），现已被 `dsh-doc` 全量取代，故删除：
  `agent-experience`、`cordis-composition-reference`、`cordis-plugin-development`、
  `editing-cordis-compositions`。
- 品牌独有的 3 个增量文件迁入 `dsh-doc`：
  `references/personal-tools.md`、`templates/personal-tool/package.json`、
  `templates/personal-tool/index.js`。
- 8 行 EternaAgent 部署段（`plugin_manager`/`plugin_market` 裁切、个人层
  `install_personal_plugin` 路径）原样保留在 `dsh-doc/SKILL.md`，并在
  `references/plugin-development.md` 增加同义部署提示，避免模型只读 reference 时
  照抄不可执行的 `install_bundle` 流程。
- 上游自带的 `agent-experience` 内容与 `dsh-doc/references/tool-design.md` 逐字相同
  （diff 仅 frontmatter 差异），保留独立目录即重复；上游 rc.5 也用仓库级 wrapper
  （`.agents/skills/agent-experience/SKILL.md` 仅链接到 tool-design.md）表达同一语义。

## 3. 检查（命令原文 + EXIT）

完整输出见本目录文件：

| # | 命令 | EXIT | 结果 |
|---|---|---|---|
| 1 | `python3 -I artifacts/rc5/p3/brand-skills/scan_brand.py` | 0 | PASS：46 文件；`DeepSeek Harness` 0、裸 `DSH` 0；见 `02-brand-scan.txt` |
| 2 | `python3 -I artifacts/rc5/p3/brand-skills/replay_diff_check.py` | 0 | PASS：43 基线逐字比对，unexpected 0；见 `03-replay-diff-check.txt` |
| 3 | `pnpm -C packages/brand test` | 0 | 2 文件 / 27 测试通过；见 `04-brand-tests.log` |
| 4 | `pnpm -C packages/brand verify` | 0 | build:client + oxlint 0 error + tsc + vitest 27/27；见 `04-brand-tests.log` |

新增守卫测试 `packages/brand/tests/skills-brand.test.ts`（10 tests）：

1. 43 个上游文件路径逐一对齐；
2. 16 个上游 references 同步（+1 增量）；
3. 品牌增量文件在位且契约含 `install_personal_plugin`；
4. `SKILL.md` frontmatter `name: dsh-doc`，Read next 覆盖增量；
5. 旧 4 个 skill 目录不残留；
6. 文档内 `references/...`/`templates/...` 引用全部存在（上游 rc.5 `skills.spec` 同款）；
7. 文档不提退休 skill 名（上游 rc.5 `skills.spec` 同款）；
8. `DeepSeek Harness` 0 命中；
9. 裸 `DSH` 品牌词 0 命中（标识符豁免）；
10. `$DSH_HOME` / `DSH_INSTALL_DIR` 等真实标识符保留（证明扫描未误伤）。

## 4. 基线解包（复现）

```sh
mkdir -p /tmp/t21/rc5
git -C <UPSTREAM> archive dsh-v0.2.2-rc.5 \
  packages/preset/agent-preset/skills/dsh-doc | tar -x -C /tmp/t21/rc5
```

`replay_diff_check.py` 按上述解包路径比较；若 /tmp 已清理，重新执行本段即可。

## 5. 遗留（不在本 lane 可改范围）

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| brand-skill-path-1 | `docs/PLUGIN-AUTHORING.md:158` 仍指 `packages/brand/skills/cordis-plugin-development/templates/personal-tool/`（已删除） | P3 | 改指 `packages/brand/skills/dsh-doc/templates/personal-tool/` |
| brand-skill-path-2 | `docs/dev/master-session-tool-schema-400.md:55` 仍指 `packages/brand/skills/cordis-plugin-development/references/personal-tools.md`（已删除） | P3 | 改指 `packages/brand/skills/dsh-doc/references/personal-tools.md` |
| brand-skill-path-3 | `artifacts/rc5/p1/*.json` 记录旧模板路径（历史证据，不影响运行） | P4 | 保留历史，不追改 |
| brand-skill-verify | 未做真 boot / 创造模式会话加载 dsh-doc 的 E2E（本 lane 只做静态重放 + 单测） | P3 | 由 P4/P5 真 boot 验收补：`tool-skill` 可加载、会话可见 `dsh-doc` |
| brand-skill-upstream-path | `references/locate-docs.md:13`（`packages/preset/agent-preset/skills/dsh-doc`，five parents）与 `references/compositions.md:7`（`packages/bundle/web-app/`）仍按上游 DSH 源码树描述；本部署从 profile `node_modules` 解析上游包 | P4 | 保持基线最小差异；若产品内确认需改，按替换表同法登记增量段 |

## 6. 证据文件

- `00-baseline-inventory.txt` — 基线 43 文件清单 + 改造前品牌 skills 36 文件清单
- `02-brand-scan.txt` — 品牌扫描（命令 + 输出 + EXIT）
- `03-replay-diff-check.txt` — 逐字重放校验（命令 + 输出 + EXIT）
- `04-brand-tests.log` — `pnpm test` / `pnpm verify` 全量日志（EXIT=0）
- `05-final-file-list.txt` — 最终 46 文件清单 + 计数
- `06-replacement-counts.txt` — 逐文件替换计数
- `07-worktree-status.txt` — `git status` 改动面
- `08-frontmatter-check.txt` — `SKILL.md` frontmatter YAML 解析（name=dsh-doc）
- `scan_brand.py` / `replay_diff_check.py` — 可复跑脚本