# 升级门禁演练报告(0.2.2-alpha.2 → 0.2.2-rc.1)

按 `docs/upgrade-gate.md` SOP 完成的首次真实升版演练。**结论:四步门禁走至第②步硬失败,裁决回滚;②的失败归因为工作区基线(未提交流水线产物)的 lint 违规,非升级回归;版本已还原,frozen install 复绿。**

- 日期:2026-11-09
- 动机:T2 验收——升级门禁 SOP 需经一次真实升版演练验证(改版本 → 本地门禁 → 裁决/还原全链路)
- 演练环境:工作区带大量未提交开发改动(本流水线产物,`git status` 42 项);node v24.18.0 / pnpm 11.7.0

## 0. 前置与保护措施

SOP §5 的回滚手段是 `git checkout` 还原版本文件,但本环境工作区带未提交改动,`git checkout` 会误伤——**还原一律用备份拷回**。演练前把三个清单/锁文件拷至仓库外并 MD5 校验:

| 文件 | MD5(备份 = 演练前) |
|---|---|
| `package.json` | `a311a42fd78b68040c7669e4ee3783b5` |
| `pnpm-workspace.yaml` | `e8c12280cc2180425333a42b52ef13a1` |
| `pnpm-lock.yaml` | `1435645a4894b71dac72b3b6848a6f9d` |

演练只允许动:§1 表中 alpha.2 版本族的版本号 + `pnpm-lock.yaml`(由非 frozen install 刷新)。

## 1. 演练变更(§1 表 alpha.2 族 → rc.1,整族一起改)

按 §1 表「同一族整族一起改」执行,`git diff` 逐文件过目,变更仅为版本号:

| 位置 | 处数 | 说明 |
|---|---|---|
| `pnpm-workspace.yaml` `catalog:` 段 | 16 | 全部 dsh-* 条目;另 2 处注释同步。`@deepseek-ai/cordis: 4.0.6-alpha.1` 非 dsh 族,未动 |
| `tools/evals/package.json` dependencies | 2 | dsh-session / dsh-user-approval |
| `packs/event-planning/package.json` peerDependencies | 1 | dsh-tools |
| `packs/industrial-analysis/package.json` peerDependencies | 1 | dsh-tools。§1 表未列该包(表写于其出现之前),归族判断:与 event-planning 同行形态(packs/* peerDependencies 精确版 alpha.2),按「不要出现半新半旧」纳入 |
| `market/glue-bundle/package.json` peerDependencies | 2 | dsh-system-prompt / dsh-tools |
| `market/pack-bundle/package.json` peerDependencies | 1 | dsh-tools |

- §0 钉版自查:输出仅剩 `packages/prompt-studio`、`packages/panel` 的「只报名不带版本的数组」——§0 明文豁免(装载清单,非依赖 specifier)。
- 各 packs/* 的 `"@deepseek-ai/cordis": ">=4.0.6-alpha.1"` 是既有形态(§1 表「不进 workspace,锁文件不涉及」行),非 dsh 族,未动。

## 2. 本地门禁(§3 四步,与 CI 逐条一致)

| 步 | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| ① 首跑 | `pnpm install --frozen-lockfile` | **1** | `[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] The current "catalogs" configuration doesn't match the value found in the lockfile`——**门禁拦截证据**:catalog 变更未刷锁,frozen 安装拒绝继续 |
| §2.2 刷锁 | `pnpm install --no-frozen-lockfile` | 0 | `Packages: +54 -46`,全部本地缓存复用(0 下载);catalogs 快照更新为 rc.1;WARN: 1 deprecated subdependency(node-domexception@1.0.0)+ peer dependency issues |
| ① 复跑 | `pnpm install --frozen-lockfile` | **0** | `Already up to date` |
| ② 全仓 verify | `pnpm -w run verify` | **1** | `@eterna/audit` verify 第一个失败:oxlint `@stylistic(arrow-parens)` → `packages/audit/tests/plugin.spec.ts:63:22` → `[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL]`;后续包 fail-fast 未完成评估 |
| ③ packctl lint packs/* | 未跑 | — | SOP §3「任何一步非 0 退出即停」 |
| ④ dsh-evals replay 全量 | 未跑 | — | 同上 |

锁文件刷新合理性核对(§2.3「只应有版本号与锁文件变更」):对备份锁文件逐行 diff,18 对 specifier 行(alpha.2→rc.1)+ 16 对纯 version 行 + rc.1 依赖树带来的 cordis 生态包块增删(cordis-plugin-loader@1.1.0、cordis-plugin-timer@1.2.0 等);新锁文件中 alpha.2 残留 0 处、rc.1 共 3199 处。

### ②失败归因(基线自带,非升级回归)

三条独立证据:

1. **违规行是未提交改动新增**:`git diff packages/audit/tests/plugin.spec.ts` 中 `reflect: { get: (name) => services.get(name) }` 为 `+` 新增行(替换原 `...(options.governance !== undefined ? ...)` 行),属本流水线未提交产物。
2. **lint 工具链版本前后一致**:`oxlint@1.81.0`、`@stylistic/eslint-plugin@5.10.0` 在备份锁文件与新锁文件中版本完全相同(备份 pnpm-lock.yaml:5617 vs 新 pnpm-lock.yaml:5247)。
3. **规则与依赖零关联**:arrow-parens 是纯语法风格规则,oxlint 不 import 任何 dsh 代码;同文件 + 同工具版本 ⇒ 演练前后 lint 结果必然相同。

正面信号:直接钉 rc.1 的 `tools/evals` verify **全绿**(vitest 10 文件 97 测试通过 + python 19 测试 OK),说明升级的直接消费方在 rc.1 下工作正常。

## 3. 裁决(§5)

**回滚。** 依据:任何一步红(② exit 1)即不满足放行条件。同时如实记录:红因经归因与升级无关(见 §2),升级本身的兼容性证据是积极的——rc.1 全族解析与安装成功(+54/-46,无 404)、门禁①复跑绿、直接消费方 tools/evals 测试全绿。**rc.1 族升版可在基线 lint 修复后重试**,本报告即 §5 要求的「升级尝试留档」。

## 4. 还原证据

| 检查 | 结果 |
|---|---|
| 备份三文件拷回 | MD5 与演练前逐一一致(`a311a42…` / `e8c1228…` / `1435645…`) |
| 五个族文件版本号逆转 | grep 零残留:六文件中无 rc.1;`pnpm-workspace.yaml` alpha.2 恢复 18 处 |
| `git diff`(六文件+锁文件 vs HEAD) | 仅剩流水线原改动:`packs/industrial-analysis/package.json` description 1 行、`pnpm-lock.yaml` 6 行——版本号零残留 |
| `pnpm install --frozen-lockfile` | **exit 0**(锁文件与清单严格一致,node_modules 拉回 alpha.2 布局,+64/-54) |
| `pnpm run lint` | **exit 1**(见下) |

`pnpm run lint` 未绿的原因:基线本身带 lint 违规,非还原引入。11 处错误全部位于流水线未提交产物,且三个文件的 mtime(00:44 / 01:53 / 01:53)均早于演练开始(02:02 备份时刻)——演练期间从未被触碰;还原后工作区与演练前逐字节一致(三文件 MD5 相同 + 族文件 diff 仅剩原改动 + 备份锁文件重建 node_modules),故 lint 输出与演练前必然相同。**还原判定以 frozen install 绿 + 版本零残留 + diff 仅剩原改动为准;lint 红如实上报,留待基线修复。**

## 5. 观察

1. **门禁①拦截有效**:catalog 变更未刷锁即被 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` 拦下,frozen 语义(锁文件与清单严格一致)得到实证——这是 SOP 设计的第一道防线,行为符合预期。
2. **verify 对基线敏感**:工作区带未提交改动时,门禁②的红混杂「升级回归」与「基线自带」两类信号。本演练的归因方法(违规行 provenance + 工具版本不变 + 规则性质)可作为标准动作;门禁红时先做归因分离,再决定回滚还是修基线。
3. **基线自带 lint 违规 11 处(全在未提交产物)**:`packages/glue/tests/fake-context.ts:82` arrow-parens;`packages/audit/tests/plugin.spec.ts:63` arrow-parens(即门禁②失败点);`packs/industrial-analysis/plugin.ts:15` 的 JSDoc 注释含 `pgvector_*/neo4j_*/…` 序列,`*/` 把块注释提前闭合,导致 9 处解析错误——该注释需改写(如以 `·` 或空格分隔)。此为 T2 验收外的附带发现,建议本流水线修复后再进 CI 门禁。
4. **SOP §5 回滚手段的适用边界**:`git checkout` 在「工作区带未提交改动」场景不可用,备份拷回是安全替代。建议 SOP 增补一句:演练/回滚前先备份三文件,还原用备份拷回。

## 6. 后续

- 修复 §5.3 的基线 lint 违规后,重放本次升版(变更清单见 §1,全程约 5 分钟),预计可走完四步并进入 CI 互证。
- `docs/upgrade-gate.md` §5 基线由 20/20 修正为 30/30(本次顺带完成)。
