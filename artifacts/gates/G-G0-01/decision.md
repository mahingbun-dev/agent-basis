# G0 决策门裁决记录（G-G0-01）

- 日期：2026-11-10
- 裁决人：用户本人（在会话中逐项过 D9–D15 后回复确认）
- 依据文档：plans/2026-11-10-companion扩展开发计划与测试门禁.md §2（G0 决策门）、plans/2026-11-10-用户浏览器作为Agent执行面-companion扩展路线调研与计划.md §7
- 用户确认原文：「没问题」（对"E1 开工前需你确认 D9-D15（扩展路线主裁决、分发方式、权限模型、sidecar 兜底、三件套形态、策略阻断处理、兼容线）"的逐项推荐方案）

## 逐项结论（全部有明确结论，无「待定」项）

| 决策点 | 结论 | 口径 |
|---|---|---|
| D9 | ✅ 按 | 采纳 companion 扩展为浏览器能力第一执行面（hybrid：扩展主 / sidecar 兜底 / tool-web 静底） |
| D10 | ✅ 按 | Chrome Web Store unlisted + 企业 ExtensionSettings 强装双轨；自托管 CRX 作不进商店客户的备选（不双主线维护） |
| D11 | ✅ 按 | debugger 权限随包（不可 optional）+ 最小 host_permissions + 其余站点 optional 按需授予 + 客户侧 runtime_allowed_hosts 指引 |
| D12 | ✅ 按 | 保留缩编版 sidecar（计划任务/浏览器未开/非 Chromium 场景）；明确不做 cookie 导出播种（DBSC 结构性死路） |
| D13 | ✅ 按 | 快用三件套由扩展端一键完成（所见即所得） |
| D14 | ✅ 按 | 策略阻断默认明确报错 + IT 指引；不实现 content-script 自动降级模式 |
| D15 | ✅ 按 | minimum_chrome_version "120" 硬地板；≥133 全功能；支持窗口「stable −4 大版本」（覆盖 Extended Stable 节奏） |

## 遗留复核项（不阻断 E1）

- D12 落地口径与 D1（v2，出站面）：仅 E5 开工前复核（G-E2E-06 查证），不影响 E1–E4。

## 签核

用户于 2026-11-10 在工作会话中对上述七项逐项推荐方案回复「没问题」，视为 G-G0-01 通过。本记录为后续全部门禁的前置输入（见 acceptance/INDEX.md）。
