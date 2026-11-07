# 可执行计划书：agent_loop 前端可视化 + system prompt 前端化管理（T7 任务流）

> 生成：2026-11-07 ｜ 状态：待执行 ｜ 仓库：/Users/sunny/code/agent-basis（分支 dev）
> 上位计划：[plans/2026-11-06-dsh企业agent路线定案.md](2026-11-06-dsh企业agent路线定案.md)（路线③ + 裁切清单 §11）；本计划为其新增任务流 **T7**，T1（Web 档裁切组合）完成后可并行，不阻塞 T2/T3。

## 1. 一句话目标

交付 @basis 双面插件「提示词工坊 + 循环轨迹」：①Web 前端图形化展示 agent_loop 会话运行态（推理↔工具调用轮次树/耗时/token/审批点）；②system prompt（personaPrefix）前端查看、修改、二次确认保存、版本管理（diff/回滚/导出/导入、版本只增不删、不可全删）、保存校验——全部写操作走 R3 审批留痕，验收 = T7.5 集成 E2E 全断言通过 + CI 五项门禁全绿。

## 2. 背景

- 需求：在路线定案基础上，把 agent_loop 循环对运营可见，把 system prompt 从「改代码/改 patch 文件」开放为受治理的前端操作。
- 仓库事实（本次核实）：`packages/agent-loop`、`packages/system-prompt` 为**空壳**（仅 node_modules，0 源文件）→ 按「零内核改动」铁律，不修改官方 `@deepseek-ai/dsh-agent-loop` / `@deepseek-ai/dsh-system-prompt` 行为，**新建 @basis 插件经官方 seam 旁挂**。
- 配方先例：`packages/panel` 已实证「一行两面」双面插件（Host=Typert SRC 端点 `basisPanel/snapshot`；Browser=`dsh.client` 声明 + `lib/client.js` 进 `window.__DSH_BOOT__` 花名册）；`docs/PLUGIN-AUTHORING.md` 五条硬性规范与 file:+symlink 装载冒烟配方可直接复用。
- 治理资产可复用：storage 栈（版本库落点，裁切清单已保留）、governance（审计事件）、interact（R3 审批卡）、observe（运行态数据源）、approval/permission 行（宿主审批）。

## 3. 访谈结论（已确认决策）

| 维度 | 结论 |
| --- | --- |
| 图形化内容 | **会话运行态轨迹**：当前/最近会话的推理↔工具调用轮次树、每轮耗时/token、审批触发点高亮；组合态结构图二期 |
| 生效方式 | **新会话生效**：保存后仅新开会话使用新 prompt；进行中会话与 KV-cache 前缀不受影响；生效通道以 T7.0 spike 实证为准（首选 patch 层+hmr，fallback 重启生效并在 UI 明示） |
| 版本与权限 | **完整版**：版本列表 + diff + 回滚 + 导出/导入；**保存/回滚/导入三类写操作全走 interact R3 审批卡**（二次确认即审批留痕）；版本库落 storage 栈，审计落 governance/observe |
| 平台 | Web 档先行（`dsh.client` platform: web）；desktop 二期沿用同配方 |
| 门禁 | 每阶段五项硬门禁（见 §6），全绿才进下一阶段；父任务将以 workflow 编排 T1-T6（+T7），每阶段独立 subagent + 门禁判定 |

## 4. 待定项与默认假设

| 待定项 | 默认假设 | 再确认时机 |
| --- | --- | --- |
| 生效通道（spike 结论） | 首选 patch 层覆写 `system-prompt` 行 personaPrefix + hmr 重载；hmr 不生效则降级「重启生效」，UI 明示 | T7.0 结束 |
| 编辑范围 | 仅 personaPrefix（领域人格全文）可编辑；最终生效的组合 prompt（含 plan-mode/skill/agent-instructions 段）以只读组合视图展示；编辑更多段落到二期 | T7.2 评审时 |
| 插件命名与编号 | `@basis/prompt-studio`（含循环轨迹视图）；任务流编号 T7 | T7.1 开工前 |
| 运行态轨迹首期覆盖 | 最近 N 条会话（默认 20）可选会话查看轨迹；全量检索二期 | T7.4 评审时 |

## 5. 范围

- **做**：T7.0 生效通道 spike；T7.1 Host 服务（SRC 端点 + 版本库 + 审计/审批对接）；T7.2 Client 半边（轨迹视图 + prompt 编辑器/组合视图）；T7.3 版本管理（diff/回滚/导出/导入/不可删规则/校验器）；T7.4 运行态轨迹数据管线（会话日志→轮次树投影）；T7.5 集成验收。
- **不做**：热生效（进行中会话切换）；desktop 端；修改官方 agent-loop/system-prompt 行为；prompt 组合树在线编辑（只读展示）；版本物理删除；全量会话轨迹检索。

## 6. 任务分解（每阶段五项硬门禁，全绿才进下一阶段）

**通用硬门禁（每阶段出口检查）**：
G1 `pnpm --filter @basis/prompt-studio run verify` 绿（oxlint + tsc strict + vitest）｜G2 装载冒烟：`grep -icE "skipping|incompatible" /tmp/basis-web-app.log` = 0 且插件页「已安装」可见（dsh.bundle 声明规范）｜G3 E2E 断言锚点全过（`data-*` 锚点 + 工具输出 JSON 特征字段，禁全文 innerText 断言）｜G4 replay 回归：活动策划 30 条金集保持全过（`dsh-evals --adapter replay` 退出码 0）｜G5 审计留痕可查（governance 审计事件含操作者/时间/版本号）

| # | 任务 | 依赖 | 产出 | 验收标准（阶段门禁） |
| --- | --- | --- | --- | --- |
| T7.0 | 生效通道 spike | T1（Web 档组合可 boot） | spike 笔记 + 选定通道（A: patch+hmr / B: 重启生效） | 断言脚本通过：改 persona → 新会话系统提示含新文本（通道 A），或重启后生效（通道 B）；旧会话不受影响可断言 |
| T7.1 | Host 服务 | T7.0 | `@basis/prompt-studio` host 半边：SRC 端点 `loopPrompt/snapshot`、`loopPrompt/trace`、`loopPrompt/prompt-get/save/versions/rollback/export/import`；版本库落 storage；governance 审计 + interact R3 对接 | G1-G5；版本读写单测过（含并发写串行化、原子写） |
| T7.2 | Client 半边 | T7.1 | 侧栏「提示词工坊」：prompt 组合只读视图 + persona 编辑器；「循环轨迹」：会话列表→轮次树（耗时/token/审批点）；全部官方语义令牌 | G1-G5；E2E：编辑器渲染锚点、轨迹树锚点、R3 审批卡再现 |
| T7.3 | 版本管理+校验器 | T7.2 | diff 视图；回滚；导出/导入（JSON 包：schemaVersion/persona/checksum/导出者）；校验器：非空、≤64KB（对齐 agent-instructions maxBytes 口径）、红线段必须存在、diff 非空才可保存；版本只增不删、至少保留初始版本 | G1-G5；vitest 覆盖校验规则全集（空文本拒绝/超限拒绝/红线缺失拒绝/校验和不符拒收）；E2E：允许一次→版本+1，拒绝→无新版本；回滚产生新版本而非删旧版本 |
| T7.4 | 运行态轨迹管线 | T7.1 | 会话日志（session-persistence-jsonl）→轮次树投影服务（容错：字段缺失降级渲染）；最近 20 条会话 | G1-G5；真实会话日志投影快照测试钉住字段口径 |
| T7.5 | 集成验收 | T7.2-T7.4 | 全链路 E2E：修改→R3 审批→新会话生效→轨迹可见（新轮次出现）→回滚→导出→再导入→版本链完整 | G1-G5 全绿 + 验收报告（逐断言 PASS/FAIL+证据原文） |

## 7. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| hmr 对 profile patch 重载不生效（此前实测 basis-web 无 HMR 需重启） | 生效体验降级 | T7.0 spike 前置；通道 B fallback（重启生效，UI 明示「保存后需重启」） |
| persona 写回若经 patch 文件：并发写/转义破坏 YAML | 组合损坏、宿主起不来 | 单写者串行 + 原子写（tmp+rename）+ 保存前 YAML 解析自检 + 失败自动还原 |
| 会话日志格式随上游版本漂移 | 轨迹投影失效 | 投影层容错降级 + 快照测试钉住字段 + 钉死 release（上位计划 T2） |
| 频繁改 prompt 跨会话 KV-cache 命中率下降 | 成本上升 | cache-guard 观测提示；编辑器显示「影响：新会话前缀将变化」 |
| R3 审批卡依赖 interact 客户端渲染 | 写操作卡死 | panel 已实证审批卡链路；T7.2 E2E 先行验证 |

## 8. 验证方式

见 §6 通用硬门禁 G1-G5 + 各阶段验收标准；最终以 T7.5 集成验收报告为准（逐断言证据原文留档，沿用 panel/graph 插件的验收惯例）。

## 9. 下一步（第一个动作）

- **动作**：T7.0 spike——在 basis-web profile 上验证「patch 层覆写 system-prompt 行 personaPrefix + hmr/重启」的新会话生效路径，产出通道结论。
- **时间 / 负责人**：T1（Web 档裁切组合 boot）完成后立即 / 待指派（可由父任务 workflow 统一编排）。

## 10. 信息来源

- `docs/PLUGIN-AUTHORING.md`：五条硬性规范、default 导出实例铁律、file:+symlink 装载冒烟配方、市场分发。
- `packages/panel/package.json` + `cordis.patch.yml` + `src/index.ts`：双面插件完整配方（dsh.client.inject 清单、SRC 端点手工装饰器、insert 装载语义）。
- `packages/glue/cordis.patch.yml`：insert 语义与 applyPatches「entry not found → continue」丢弃行为实证。
- 本会话已核实的 base 树行清单：system-prompt（personaPrefix）、agent-loop（agents:[]）、storage 三件套、session-persistence-jsonl、approval/permission、agent-instructions maxBytes 65536。
- 本访谈三答：会话运行态轨迹 / 新会话生效 / 完整版（R3 审批全覆盖）。
