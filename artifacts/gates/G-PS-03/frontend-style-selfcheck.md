# G-PS-03 附件：frontend-style §4 PR 自查清单（T3.2/T3.3 AI 润色区与审核报告卡）

> 规范：`docs/design/frontend-style.md` §4（6 项）。逐项给证据；无法机器判定处如实标注。格式沿 G-PS-01 先例。
> 本期 UI 改动面：StudioPage.tsx 新增 AiPolishSection / AiReviewSection / AiDraftDiff；styles.ts 新增 AI 区样式段；locales.ts 新增 AI 文案。

| 清单项 | 结论 | 证据 |
| --- | --- | --- |
| ① 只用 §2 令牌（无新增硬编码色） | ✅ | 机器断言三层：a) vitest `client-bundle.test.ts` 令牌正则断言（逐文件颜色声明只经 `--dsw-alias-*`/`color-mix`/`transparent`）+ AI 锚点九项在 bundle——#1 实跑 329/329 内（client-bundle 20/20）；b) `t7-ui-check` combo 无 `color:#hex`——#4 实跑 60/60 内；c) 本代理 grep 实测（`grep -o` 计出现次数，与 G-PS-01 口径一致）：client 源 `--dsw-alias-` 出现 **251** 次（styles.ts 250 + StudioPage.tsx 1；基线 136 行 → G-PS-01 时 173 次 → 本期只增），字面色值色声明 **0** 处（styles.ts 行计数 241 亦只增于 G-PS-01 时的 166） |
| ② 深浅两主题各截图核对 | ✅ | screenshots/ 4 张（AI diff 视图 + 审核报告卡 × 双主题，md5 全异）；AI 视觉复核（G-PS-01/02 同款四问复核）：浅色 diff 卡完整（建议稿卡 4507ms 生成信息/+1/-1 红删绿增行/提案与放弃按钮）、深色 diff 对比清晰无黑底黑字、浅深两版报告卡（rule 3 · ai 5/6，severity 徽标/建议列表/关闭按钮）均无重叠溢出（复核结论全文见 EVIDENCE.md §3） |
| ③ topbar 返回/退出可达；无原生对话框 | ✅（适用面说明） | studio 仍为 `main` keyed 面板（dsh 官方槽位，无独立页面入口——AGENTS.md 形态铁律）；无原生对话框：client 源 `confirm(`/`alert(` grep=**0**（本代理实测，含本期新增 AI 区）；「放弃建议稿」为可撤销预览丢弃（建议稿仅内存态，非破坏性直写），生效类操作仍走 R3 审批卡（host-plugin 断言 doubleConfirm 先例不变） |
| ④ 资料合并保存 + 密码独立卡；脏检查与防重复点击在位 | ✅（同构面说明） | 本期无密码类卡片（不适用）；AI 区防重复点击：润色/审核共用 wire 单飞互斥（`aiBusyOp` 状态机，StudioPage.tsx:809-812——任一 AI 调用在途则两区按钮全禁用且各自显示在途文案），提案提交 busy 禁用（blockPolish/blockReview 组合式，StudioPage.tsx:594-598）；建议稿为预览态不触写通道（「作为提案提交」才进 R3）——DOM 实测 proposeBtn idle 态在场（shots-summary.json） |
| ⑤ 640px 断点 + reduced-motion | ✅ / ✅（平凡满足） | 640px：`styles.ts:592` `@media (max-width: 640px)`（AI 区落在既有单列布局内，收边距与字号规则同面生效；G-PS-01 已有双主题 640px 截图先例）；760px 不适用（面板单列布局仅一档断点）。reduced-motion：studio 样式 animation/transition 声明 grep=**0**（T3 零新增动画，无动画可减，规约平凡满足；若后续加动画须同步补 `@media (prefers-reduced-motion: reduce)` 块——G-PS-01 同款边界说明） |
| ⑥ 服务端页 `no-store` | N/A（说明） | studio 为纯客户端面板（无 HTML 响应渲染）；本期 AI 端点均为 JSON RPC，无服务端 HTML 面；`no-store` 纪律由既有服务端端点承载，不在本期改动面（G-PS-01 同款说明） |

## 视觉走查补充

- `:focus-visible` 光圈规则在场：styles.ts 共 **4** 处（含全部 button 通例），官方语义令牌 outline。
- 键盘 Tab 顺序/焦点光圈真人走查：**未执行**（非 §7.3 具名要求；静态规则与 G-PS-01 先例标注同口径，留真人复核）。
- 本期新发现缺陷（§5-1）：可用性胶囊运行态滞留「检测中」——显示层缺陷，与令牌/布局/可达性规约无关，已如实入截图与 EVIDENCE。
