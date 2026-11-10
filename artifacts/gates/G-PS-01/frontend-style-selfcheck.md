# G-PS-01 附件：frontend-style §4 PR 自查清单（T1.5 StudioPage 全景改版）

> 规范：`docs/design/frontend-style.md` §4（6 项）。逐项给证据；无法机器判定处如实标注。

| 清单项 | 结论 | 证据 |
| --- | --- | --- |
| ① 只用 §2 令牌（无新增硬编码色） | ✅ | 机器断言三层：a) vitest `client-bundle.test.ts:89`（逐文件颜色声明只经 `--dsw-alias-*`/`color-mix`/`transparent`）与 `:110`（数量只增 ≥ 基线 136），本代理实跑 12/12 过（outputs/verify-prompt-studio.log）；b) `t7-ui-check` combo 无 `color:#hex`（实跑 PASS）；c) 本代理 grep 实测：client 源 `--dsw-alias` 出现 **173** 次（styles.ts 166 行命中 + StudioPage.tsx），字面 hex 色值 **0** |
| ② 深浅两主题各截图核对 | ✅ | screenshots/ 8 张（三视图 × 双主题 + 640px × 双主题，md5 全异）；AI 视觉复核：深色版确为深色（近黑背景/白主文字）且与浅色版结构一致、无白底黑字块/透明文字错乱（复核记录见 EVIDENCE.md §3） |
| ③ topbar 返回/退出可达；无原生对话框 | ✅（适用面说明） | studio 是 `main` keyed 面板（dsh 官方槽位形态，client/index.ts:121-131），返回/退出由产品壳 topbar 承担（面板不自带独立页面入口——AGENTS.md 形态铁律）；无原生对话框：client 源 `confirm(`/`alert(` grep=**0**（本代理实测）；破坏性操作为两击确认样式（R3 卡 doubleConfirm，host-plugin/e2e 断言 questionItems=2） |
| ④ 资料合并保存 + 密码独立卡；脏检查与防重复点击在位 | ✅（同构面说明） | 本面板无密码类卡片（不适用）；资料类=条目编辑器单卡合并保存：脏检查（编辑器字节计数与「与当前生效内容一致」状态行，截图可见 `54 / 65,536 字节`）、保存按钮带 busy 防重复（host-plugin 拒绝分支 + e2e 两段式）；回滚/导入为破坏性操作走 R3 审批+确认（非静默直写） |
| ⑤ 640px 断点 + reduced-motion | ✅ / ✅（平凡满足） | 640px：`styles.ts:380` `@media (max-width: 640px)`（单列收边距与字号，:379 注释），截图 studio-panorama-640-{light,dark}.png 辅证；760px 不适用（面板单列布局仅一档断点）。reduced-motion：studio 样式 animation/transition 声明 grep=**0**（无动画可减，规约平凡满足；对照 access 因用 transition 而显式落了 `@media (prefers-reduced-motion: reduce)` 块——若后续加动画须同步补降级块） |
| ⑥ 服务端页 `no-store` | N/A（说明） | studio 为纯客户端面板（无 HTML 响应渲染）；`no-store` 纪律约束服务端 HTML 端点（如 access 登录门禁页），本插件无该面。宿主侧该纪律由既有端点约定承载，不在本期改动面 |

## 视觉走查补充（T1.5 验收标准「键盘可达」）

- `:focus-visible` 光圈规则在场：styles.ts:86（editor）、:96（save summary）、:368（全部 button）——`outline: 2px solid var(--dsw-alias-state-business-primary)`，走官方语义令牌。
- Tab 顺序/光圈真人走查：**未执行**（人工步骤；静态规则与截图已给，留真人复核）。
