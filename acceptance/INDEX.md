# 验收记录索引

> 依据 plans/2026-11-10-companion扩展开发计划与测试门禁.md §4 治理原则建立。
> 全部门禁通过与失败的工件按门禁 ID 存入 `artifacts/gates/<门禁ID>/`；失败记录永久保留。
> 实现者及其关联会话无判定权；执行者由用户本人书面指定（含用户本人亲自担任）。

| 门禁 ID | 阶段 | 执行人 | 执行日期 | 结论 | 工件 | 备注 |
|---|---|---|---|---|---|---|
| G-G0-01 | E0（决策门） | 用户本人 | 2026-11-10 | ✅ 通过（D9–D15 七项全部有明确结论） | [artifacts/gates/G-G0-01/decision.md](../artifacts/gates/G-G0-01/decision.md) | 用户会话回复「没问题」确认逐项推荐方案；本记录为后续全部门禁的前置输入 |
| E0-T3 红线清单签核 | E0 | 用户本人 | 2026-11-10 | ✅ 签核（用户会话确认「继续执行」） | docs/design/companion-security-redlines.md | 十条红线作为后续协作与安全门禁组（G-UX-10/11/12/13）及总验收的判定基准 |
| E0-T2 / E1-T1 / E1-T2 / E1-T5 | E0+E1 实现 | 实现者（本会话） | 2026-11-10 | ✅ 实现完成 + 自测证据（**非门禁判定**） | packages/extension-companion、packages/browser-relay、`pnpm -w run verify` 退出码 0（125 测试全过）、packctl tenant-scan 0 findings | 见下「实现者自测证据」 |

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

## 失败-修复-重跑链

- 2026-11-10 E1 自测期间（实现者内部迭代，非门禁运行）：chrome.debugger attach 竞态（Another debugger）→ 两端在途去重；AX 域整树 ignored → 感知通道切换 DOMSnapshot；backendNodeId 跨域编号 → DOM.resolveNode 桥接。修复过程细节见实现会话记录。
