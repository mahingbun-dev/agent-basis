# 逐条目热生效实测矩阵(T2.2)

> 生成:2026-11-11 ｜ 配套:计划书 [plans/2026-11-11-提示词工作室全景化改造计划.md](plans/2026-11-11-提示词工作室全景化改造计划.md) §6 T2.2 行、测试计划 [ps-v2-test-plan.md](ps-v2-test-plan.md) §4 T2.2。
>
> 本文回答一个问题:**经提示词工作室保存(两段式 R3 审批)修改任一注册表条目后,改动什么时候生效、对谁生效**。每个格子的结论都引用 `scripts/t7-e2e.mjs` 断言编号(断言链 15 + 既有链 5/6/8/9/14),**无断言编号的格子判为未实测**——本文与 `packages/prompt-studio/src/registry.ts` 的 `effect` 字段(`PromptEffectRadius`)互相锁住:改半径先改实测;UI「生效条件」区(`data-ps-entry-effect`)与 [ps-v2-registry-ledger.md](ps-v2-registry-ledger.md) 的「生效半径」列同源引用。
>
> **实测记录**:2026-11-11 `node scripts/t7-e2e.mjs` 全量真模型整跑,**PASS=140 / FAIL=0,exit 0**(断言链 15 共 52 条全过;三次迭代修正过程见 §6——修正的是断言判据与审计记录面,非实测结论本身)。

## 1. 实测方法(判据与夹具)

| 项 | 口径 |
| --- | --- |
| 判据唯一通道 | `node scripts/t7-e2e.mjs`(测试计划 §4 T2.2(a);矩阵断言全部并入断言链 15,基线只增不减:静态 `grep -c "check('"` = **120**(≥既有 88),另有 F/G、H/I 两处循环生成断言(6×2+4×2=20 条运行时),运行时合计 **140** 条全 PASS) |
| 「即时(新会话)」黄金判据 | 保存生效后,在**同一宿主进程**(`host.pid` 不变,断言 15.5/15.15/15.22/15.41 逐段在场)新建会话,系统提示立即用新文——不等 8s 文件监视 HMR、不重启(configEditor 同步重组合) |
| 「进行中会话」第二面 | 已开启会话补一轮,观测其沿用开启时快照(T2.4 严格回放,断言 8.1/14.9)或 durable 首条指令消息(断言 15.6) |
| 「不可写」判据 | `loopPrompt/prompt-save` 对该条目 fail-closed 拒写,issues 明示成因(断言 15.24-15.27) |
| 「无组合面」判据 | 写回落盘 + 同进程 `dsh --dump-config` 组合树**不含**新文(断言 15.34F/15.34G/15.38H/15.38I)——改动不进入任何运行中组合 |
| 宿主与隔离 | t7-studio 隔离档(`.eterna-home-t7`,DSH_HOME 语义;宿主 127.0.0.1:3108;真模型 LITELLM 凭据只进宿主进程环境) |
| cordis 同构夹具 | t7 档 patch 层新增 `preset-cordis` 行(生产档形状:persona/agent-instructions/time-context/planning→plan-mode 四子插件;断言 15.9 证明已入组合)。**文本刻意与 standard 档互异**——生产档两预设 plan 段文本逐字相同,会使回放身份判定落入 `SKIP_GOVERNING_AMBIGUOUS`(fail-safe 跳过);夹具互异后 cordis 四条目的半径可测,该差异在 §4 已知限制中如实登记 |
| 指令链夹具 | 会话 cwd=`/tmp/t7-e2e-ws-<pid>`(git 项目根)内放 `AGENTS.md`(≈130B,标记行在后段);`agent-instructions.maxBytes` 的半径以「标记是否被新上限截掉」观测。**注入形态实测**为 `user/message` 事件的 `<system-reminder>` 载荷(首轮 request 内,非 system-prompt source)——断言按全消息面取(15.3/15.5/15.6/15.13/15.16) |
| 会话选预设 | 上游 `agentPresets/select`(wire 字段 `agentId`;会话首回合前选定,断言 15.11)——cordis 条目的会话面观测通道 |
| 领域层安全网 | 断言链 15 对四份仓库 pack 文件「改→回滚」后做标记零残留复核(15.42);`>-` 折叠块回滚是**按值重述**(语义等价,块字节可规范化),字节级还原由脚本 finally 兜底统一执行(运行后 `git status packs/` 干净) |

## 2. 矩阵(14 条 × 生效半径;全部实测)

生效半径三档(计划书口径)+ 不可写两型;**「即时」均指对新会话即时——进行中会话按会话快照沿用旧文(T2.4 严格回放,这是设计语义而非失效)**。

| 条目 | 型别 | 写通道 | 生效半径 | 对进行中会话 | 断言编号(t7-e2e.mjs,2026-11-11 实测 PASS) |
| --- | --- | --- | --- | --- | --- |
| preset.standard.persona | patch 值型 | configEditor(官方 seam) | **即时(新会话)** | 沿用开启时快照(旧文) | 5.11(新会话 C 立即新文,pid 不变)、6.2、8.1(旧会话 A 不吸收)、9.2(回滚闭环) |
| preset.standard.agent-instructions | patch 值型 | configEditor | **即时(新会话)** | 首条指令消息 durable,不改写 | 15.2-15.8(64B 截断:新会话 I2 标记消失=15.5;旧会话 I1 补轮仍含=15.6;回滚值回 65536=15.7/15.8) |
| preset.standard.plan-mode.section | patch 值型 | configEditor | **即时(新会话)**;plan 模式激活时才注入 | 沿用快照旧段(严格回放) | 14.6(写回)、14.7/14.8(新会话 Q 新段)、14.9/14.10(旧会话 P 旧段)、14.11(pid 不变) |
| preset.cordis.persona | patch 值型(>- 折叠块) | configEditor | **即时(新会话)**;经 `agentPresets/select` 选定创造模式的会话 | 沿用开启时快照 | 15.9-15.17(同构行:C1 基线/预设隔离=15.11/15.12,写后 C2 即时新文=15.15,双回滚=15.17) |
| preset.cordis.agent-instructions | patch 值型 | configEditor | **即时(新会话)**(同 standard 档机制) | 首条指令消息 durable | 15.13(C1 指令链注入)、15.14(写回)、15.16(C2 截断)、15.17(回滚) |
| preset.cordis.plan-mode.section | patch 值型(\| 字面块) | configEditor | **即时(新会话)**(同 standard 档机制) | 沿用快照旧段 | 15.18-15.23(C3 基线=15.20,写后 C4 即时新段=15.22,回滚=15.23) |
| preset.standard.time-context | 行锚点只读型 | —(fail-closed 拒写) | **不可写**(上游每次组装生成,无「改后生效」) | 不适用 | 15.24(rejected+「无 patch 写回落点」);t7-smoke 既有只读拒写断言同口径 |
| preset.cordis.time-context | 行锚点只读型 | —(fail-closed 拒写) | **不可写**(同上) | 不适用 | 15.25(rejected+同明示) |
| domain.event-planning.persona-prefix | patch 值型(>- 折叠块) | entry-patch 直写兜底(审计 channel=entry-patch,15.32F) | **无组合面**:写回落点=仓库 pack 文件;生产 eterna-web 档与 t7 档的 profile bundles 均不含领域包——改动不进入任何运行中组合 | 不适用 | 15.30F(前置)/15.31F(写回)/15.32F(通道)/15.33F(落盘+同进程读回)/15.34F(组合树不含)/15.35F(回滚:反引值回基线,语义等价重述) |
| domain.industrial-analysis.persona-prefix | patch 值型(>- 折叠块) | entry-patch 直写兜底 | **无组合面**(同上) | 不适用 | 15.30G-15.35G(同 F 结构) |
| domain.event-planning.persona-md | patch 值型(整文件) | entry-patch 直写兜底 | **无组合面**:仓库内未见运行时注入代码,该文件当前不参与任何宿主组装 | 不适用 | 15.36H-15.39H(前置/写回/组合树不含/回滚字节还原) |
| domain.industrial-analysis.persona-md | patch 值型(整文件) | entry-patch 直写兜底 | **无组合面**(同上) | 不适用 | 15.36I-15.39I(同 H 结构) |
| runtime.memory.index-section | 运行时注入型 | —(fail-closed 拒写) | **不可写;文本每次装配由宿主重建**,不受快照回放冻结(回放按型跳过) | 每次装配跟随运行时状态(不冻结) | 15.26(rejected+「运行时注入型」)、15.28(审计 skippedEntries reason=runtime-injection,applied|governed 事件均携带)、15.29(快照在场标注,不伪造 versionId) |
| runtime.glue.memory-plugin | 运行时注入型 | —(fail-closed 拒写) | **不可写**(同上;同一 section 的装载层) | 同上 | 15.27(rejected)、15.28(回放按型跳过) |

声明对账:断言 **15.1**(snapshot `entries[]` 14 条全部带 `effect.radius` 枚举值)与 **15.40**(registry 声明 ↔ 上表逐面一致:preset patch 值型×6=即时、time-context×2=readonly-upstream、domain×4=not-composed-anywhere、runtime×2=runtime-rebuilt)把本表与代码互相锁住;**15.41/15.42**(矩阵全程 pid 不变 + 领域层零残留)是矩阵收尾。

## 3. 「需重启」一档的现状

**当前注册表 14 条目中没有任何一条实测为「需重启」**:preset 层条目全部经 configEditor 官方 seam 同步重组合(即时);领域层条目不是「需重启」而是**更强的「无组合面」**(当前根本没有宿主装载该来源,重启也不进入组合——若未来有宿主把领域包加入 `dsh.profile.bundles`,其半径需按该宿主另行实测,本文不臆测)。entry-patch 直写兜底通道(persona-patch 时代通道)本身依赖文件监视 HMR(≈2-8s)重组合——该通道对 live patch 条目仍是「不重启、新会话生效」,只是存在 HMR 等待窗;本轮矩阵全部领域层写走的即此通道(写回+回滚闭环实测),无一需要重启。

## 4. 已知限制(如实登记,不造 restart 假象)

1. **生产档两预设 plan 段文本逐字相同**(`profiles/eterna-web/cordis.patch.yml` :188-199 与 :331-342),会使回放身份判定落入 `SKIP_GOVERNING_AMBIGUOUS` fail-safe 跳过——旧会话 plan 段在两段被改成同文后**不替换**(防张冠李戴)。t7 夹具刻意互异以测出 cordis 半径;生产档若需该回放语义,需先把两段文本改互异(或接受跳过)。这是 T2.4 回放的身份判定语义,非热生效失效。
2. **agent-instructions 的截断语义按上游 README 口径是「每条指令链(user-global/project)分别上限」**:15.5/15.16 实测的是 project 链(cwd 项目根 AGENTS.md);user-global 链($DSH_HOME/AGENTS.md)在同一机制下,未单独开链实测(本仓 DSH_HOME 无全局 AGENTS.md,不造夹具)。
3. **领域层「无组合面」是当前部署形态的结论**:生产 eterna-web 与 t7 隔离档的 `dsh.profile.bundles` 均为 `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`(profiles/eterna-web/cordis.patch.yml 文件头注、t7 profile package.json)。装载领域包的宿主(如 evals/领域工作台形态)上 personaPrefix 的会话面半径**未实测**,不在本表冒充结论。
4. **runtime 条目「每次装配重建」的半径面**:本轮实测了「写链路不可写(15.26/15.27)+ 回放按型跳过(15.28)+ 快照在场标注(15.29)」;「状态变化→下一次组装即时反映」由上游 `PromptSection.text` provider 机制保证并在 T2.6 单测(memory/glue 假 ctx)覆盖,t7 e2e 档未装载 memory/glue 插件,未做会话面观测——如实登记,不臆测。
5. cordis 四条目的半径在 **t7 同构夹具行**上测得(生产 preset-cordis 行与夹具行结构相同、文本不同);生产档本体未起宿主实测(需真实创造模式会话与凭据,留 G-PS-02 gate 判定人环境)。
6. **`>-` 折叠块条目的回滚是按值重述**:回滚后反引值与写前基线逐字一致(15.35F/G 实测 `valueRestored=true`),但块的字节排版可被规范化(续行折行变化)——T1.6 写回契约本就是「语义等价重述+round-trip 自检」,不承诺字节排版冻结;整文件条目(persona.md)回滚字节精确还原(15.39H/I 实测 `restored=true`)。

## 5. 复现命令

```bash
node scripts/t7-e2e.mjs     # 断言链 15 全量(需 .secrets/litellm-*.txt 凭据;真模型回合)
```

运行后逐条输出 `[PASS]/[FAIL] 15.x`;本文表格断言编号与脚本 `check('15.x …')` 一一对应(机械计数:`grep -c "check('" scripts/t7-e2e.mjs` = 120 ≥ 基线 88,另 F/G、H/I 循环生成 20 条,运行时合计 140;基线只增不减)。

## 6. 实测迭代记录(诚实起见,判据修正 ≠ 结论修正)

| 轮次 | 结果 | 修正内容 |
| --- | --- | --- |
| run1 | 未起(TDZ 语法错) | 常量声明序修正 |
| run2 | 96/2 + FATAL | ① 指令链注入形态实测为 `user/message` `<system-reminder>`(非 system-prompt source)——全消息面取;② `agentPresets/select` wire 字段实测为 `agentId` |
| run3 | 135/5 | ① cordis persona 新文与基线互斥化(原新文含基线子串,「不含基线」判别恒假);② `>-` 折叠块回滚判据改语义等价(实测:按值重述,字节排版可规范化);③ 回放审计 governed 事件补 `skippedEntries` 字段(此前只在 applied 事件携带——scoped 持旧实例会话走 governed 路径时按型跳过记录在审计面缺席,系 T2.4「跳过并记录原因」承诺的记录面补全,字段只增) |
| run4 | **140/0,exit 0** | 定稿 |
