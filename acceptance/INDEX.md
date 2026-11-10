# 验收记录索引

> 依据 plans/2026-11-10-companion扩展开发计划与测试门禁.md §4 治理原则建立。
> 全部门禁通过与失败的工件按门禁 ID 存入 `artifacts/gates/<门禁ID>/`；失败记录永久保留。
> 实现者及其关联会话无判定权；执行者由用户本人书面指定（含用户本人亲自担任）。

| 门禁 ID | 阶段 | 执行人 | 执行日期 | 结论 | 工件 | 备注 |
|---|---|---|---|---|---|---|
| G-G0-01 | E0（决策门） | 用户本人 | 2026-11-10 | ✅ 通过（D9–D15 七项全部有明确结论） | [artifacts/gates/G-G0-01/decision.md](../artifacts/gates/G-G0-01/decision.md) | 用户会话回复「没问题」确认逐项推荐方案；本记录为后续全部门禁的前置输入 |
| E0-T3 红线清单签核 | E0 | 用户本人 | 2026-11-10 | ✅ 签核（用户会话确认「继续执行」） | docs/design/companion-security-redlines.md | 十条红线作为后续协作与安全门禁组（G-UX-10/11/12/13）及总验收的判定基准 |
| E0-T2 / E1-T1 / E1-T2 / E1-T5 | E0+E1 实现 | 实现者（本会话） | 2026-11-10 | ✅ 实现完成 + 自测证据（**非门禁判定**） | packages/extension-companion、packages/browser-relay、`pnpm -w run verify` 退出码 0（125 测试全过）、packctl tenant-scan 0 findings | 见下「实现者自测证据」 |
| T7 存量补登（T7.5 集成验收等） | T7（ps-v2 前史） | T7.5 集成验收官（动态 workflow subagent） | 2026-11-07 | ✅ 实测通过（72 项断言全 PASS / 0 FAIL，exit 0，连续三次；**补录性质**） | [docs/dev/t7-acceptance.md](../docs/dev/t7-acceptance.md)、[docs/dev/t7-prompt-studio.md](../docs/dev/t7-prompt-studio.md) | 计划书 §8 现状缺口（T7 无 INDEX 条目）按 ps-v2 测试计划 §1「INDEX 台账」行于 G-PS-01 一并补登；数字出处 t7-acceptance.md 逐断言台账（当时插件名尚为 @basis/prompt-studio，改名前史） |
| G-PS-01 | P1（ps-v2：挂载+全景+写链路） | 独立验收代理（验收-G-PS-01，用户经工作流书面指定） | 2026-11-11 | ✅ 通过（§7.1 强断言 1–7 全过，第一手实测；真模型链 t7-e2e 72/72 已跑） | [artifacts/gates/G-PS-01/EVIDENCE.md](../artifacts/gates/G-PS-01/EVIDENCE.md) | 见下「G-PS-01 验收记录」；人工条款缺口（键盘全量走查、admin 停用裁剪[可缺席]）已如实标注未执行/部分执行 |

## 实现者自测证据（2026-11-10，E1 冒烟——非门禁判定）

- 环境：Chromium for Testing 159.0.8154.0（headless=new + --force-renderer-accessibility + --load-extension）+ relay 127.0.0.1:9310 + 扩展 0.1.0 开发者加载。
- 全链结果（smoke/e1-smoke-result.json，exit=0）：
  1. ✅ relay 启动（/extension /cdp /api/tools /fixture）
  2. ✅ 扩展 SW → wss 连接 relay（hello 握手 proto=1）
  3. ✅ browser_snapshot {url:fixture} → a11y 快照（heading/paragraph/textbox[ref=e10]/button「提交」[ref=e13]/link[ref=e16]）
  4. ✅ browser_fill（selector=#kw → value=playwright）
  5. ✅ browser_click（selector=#go → 导航至 /fixture/result?text=playwright）
  6. ✅ 动作后快照含预期内容（关键词：playwright）
  7. ✅ example.com 真实快照（R-02 场景，title=Example Domain）
- 工具协议要点：感知走 DOMSnapshot.captureSnapshot（browser-use 同款主通道；chrome.debugger 下 AX 域整树 ignored 不可控，已实测确认并绕开）；ref=e<backendNodeId> 文档内稳定；点击为 CDP Input 可信事件（DOM.resolveNode→callFunctionOn 取视口中心）。
- 单测：relay-core 10 项（握手/自动挂载/session 转发/detach 分类/生命周期/错误码）+ ax-snapshot 7 项（已由 DOMSnapshot 通道替代，保留作 AX 通道回归基础）。

## E1 挂载验证（实现者证据，2026-11-10）

- `scripts/verify-eterna-web.mjs`（真 boot + pluginInventory/list 断言）exit=0：
  200 host entries 全 settle、`mcp-browser` enabled+active、22 裁行全 inactive、124 保留行 enabled+active。
- MCP 协议级：官方 SDK 2.2.0 Client + StdioClientTransport 对 `dist/mcp.mjs` connect 220ms 成功、
  tools/list 返回三工具（实测根因：响应帧缺 `jsonrpc:'2.0'` 时 SDK zod 校验静默丢弃全部响应——
  根因与修复已注释在 mcp.ts）；era 探针 `server/discover` 按 -32022+supported 语义毫秒级回落 legacy。
- 工具面挂载完成 → G-CORE-01/02/03/05 的「eterna 会话」前置条件就绪（待模型 key + 独立验收代理）。

## G-CORE 门禁待执行清单（实现者无权判定，待独立验收代理）

| 门禁 | 阻塞前置 |
|---|---|
| G-CORE-01/02/03/05 | ① 浏览器工具挂进 eterna 会话工具面（MCP server 化或 DSH provider 化——实现者待办）；② 用户书面指定独立验收代理 |
| G-CORE-04（登录态只读） | 用户本人提供已登录站点环境 + 书面确认单 |

## G-PS-01 验收记录（ps-v2 P1，2026-11-11，独立验收代理实测）

- **判定文本**：`docs/dev/ps-v2-test-plan.md` §7.1 强断言 1–7；证据目录 `artifacts/gates/G-PS-01/`（逐任务断言映射 + 命令台账 + 截图 + §4 自查 + 全部原始输出誊录，含失败运行日志）。
- **无头命令实测**（均 exit 0）：verify-eterna-web 11/11（生产档 studio 行 enabled+active + 花名册 combo 含 client.js/factory 注册）；t7-smoke **68/68**；t7-ui-check **31/31**；t7-e2e **72/72**（真模型 A–G 链，凭据在位）；packctl tenant-scan 0 findings；packctl lint 逐包两条（event-planning / industrial-analysis）各 0/0；dsh-evals replay t14-replay 9 用例全过。机械计数：t7-e2e 72 / t7-smoke 68 / t7-ui-check 21+1 循环（基线 ≥72/≥38/≥17+循环，只增达标，誊录与 grep 一致）。
- **包级 verify 实测**：`@eterna/prompt-studio` 211/211（含 registry 24 / entry-patch 22 三形态专项 / host-plugin 44 per-entry 六项 / client-bundle 12 令牌）、`@eterna/access` 67/67（启停登记回归面）。全仓 `pnpm -w run verify` 由验收工作流外层 harness 另行运行判定，不入本代理证据。
- **截图**：深浅两主题 × 全景列表/条目编辑/版本 diff 三页 + 640px 断点 × 双主题共 8 张（playwright-core+系统 Chrome，脚本随证据目录可复现）；AI 视觉复核：浅色三层 14 条全景完整、深色主题正确无样式错乱。
- **人工条款如实标注**：键盘可达全量走查未执行（静态 focus-visible/断点规则在场已给替代证据）；admin 停用→重启裁剪未执行（计划书 T1.2 标注可缺席；机器层 id 三处交叉钉住 + access verify 已覆盖）。
- **环境发现（转实现者，非门禁阻断）**：① `scripts/t7-e2e.mjs` 冷自举 pnpm-workspace 模板缺 `@google/genai`/`protobufjs` allowBuilds 裁定（t7-smoke 已修，t7-e2e 未同步）——全新 profile 下 install 失败，本次验收以 scratch 侧手工补齐绕过（未改任务代码）；② 新 worktree 需先 `pnpm --filter @eterna/llm-openai run build`，否则 t7 宿主 eterna-llm 装载失败且 t7-e2e 四断言以远离根因形态变红（建议加 eterna-llm active 启动断言）；失败链 4 次运行日志完整保留于证据目录。

## 失败-修复-重跑链

- 2026-11-11 G-PS-01 运行（验收代理，环境根因）：t7-e2e run1–run4 失败（4 断言簇 + 冷自举 install 失败）→ 根因=llm-openai lib 构建产物缺失（file: 拷贝无 lib → eterna-llm failed to import → 真模型回合静默退化）+ t7-e2e 冷自举模板缺 allowBuilds 裁定 → 环境侧修复（build + 重建 profile node_modules）后终跑 72/72 exit 0。全部日志保留 artifacts/gates/G-PS-01/outputs/（t7-e2e.run1–4.log + 终跑 t7-e2e.log）。
- 2026-11-10 E1 自测期间（实现者内部迭代，非门禁运行）：chrome.debugger attach 竞态（Another debugger）→ 两端在途去重；AX 域整树 ignored → 感知通道切换 DOMSnapshot；backendNodeId 跨域编号 → DOM.resolveNode 桥接。修复过程细节见实现会话记录。
