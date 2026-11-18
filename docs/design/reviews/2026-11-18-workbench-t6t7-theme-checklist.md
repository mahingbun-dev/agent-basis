# T6/T7 新增组件深浅双主题对照检查清单(38-T14 主题自查)

> 依据:**38 号 §5 T14 行**「每个 UI PR 深浅双主题截图对照原型 + frontend-style §4 清单自查(持续纪律)」;**30 号 §4-4**「深浅双主题截图进 PR」、§5 原型先行流程;**24 号 §6 P2 行**;**33 号 G2-D2**。门禁原文(G2-D2):`ls docs/design/prototypes/<id>/prs/<PR号>/{light,dark}.png`(存在且 >20KB)+ `grep "PR-<n>" docs/design/prototypes/INDEX.md`。
>
> 本清单 = T14 的人工半(逐状态点浅/深截图对照);机器半已落:
> - 令牌真值源:`packages/ui/src/tokens.ts`(唯一十六进制豁免面,AGENTS.md 铁律 2);
> - 状态点契约:`packages/workbench/theme-state-points.json`(本表与其同步于 2026-11-18,机器门禁读它);
> - 机器门禁①:`node scripts/lint-ui-tokens.mjs`(G0-2,verify 链首步——已扩 `packages/workbench/src` 扫描 + 状态点 enforce 核对 + anchorChecks 选择器级精查);
> - 机器门禁②:`packages/workbench/tests/theme-tokens.spec.ts`(包级 verify 内断言,同一契约);
> - 报告:`node scripts/lint-ui-tokens.mjs --report <path>` 落盘逐文件令牌计数 + 状态点核对 JSON(本轮快照:`artifacts/gates/G0-2/theme-token-report.json`)。
>
> 核对状态:T6/T7 组件与样式已于 2026-11-18 03:23–03:34 落地(S2-T6T7 并行施工),本清单实现核对列已按实落地代码回填(styles.ts:行号)。机器核对结果:**enforce 状态点 30/30 全绿(含 2 处 anchorChecks 选择器级精查——首轮检出「验收通过/提交回答沿用 T9 描边锚点」的实心主操作偏差,G0-2 报 anchorCheck 失败后由 T6/T7 以作用域实心规则收口,§1.3 ★)**。
>
> **行号校正(2026-11-18 S2-T14 复核)**:styles.ts 于当日 10:12 被并行施工再次改动(工作树无 diff 可考,workbench 包未跟踪),本清单全部 styles.ts 行号已按 10:12 版本逐条重新核对回填(T6 面 = §1 表内行号,文件现 784 行);TaskSidebar.tsx(03:35)/AttentionBanner.tsx(03:36)两组件行号复核未漂移。行号校正后三门禁由本工位实跑复绿:`node scripts/lint-ui-tokens.mjs` exit 0(11 目录 165 文件,60 令牌,状态点强制 30/30)、`--report artifacts/gates/G0-2/theme-token-report.json` 重写(issues 0/enforced 30/ok 30/pending 0/failed 0)、`pnpm --filter @eterna/workbench run verify` 全绿(15 spec/179 tests,theme-tokens.spec.ts 14 tests)。红/挂起两路径同批自证:①清单注入未定义令牌 + anchorCheck 追加块外令牌 → exit 1 逐状态点与选择器点名(dot-ready / ask-card「reply-row'] [data-eterna-workbench='btn'」),还原后 exit 0;②暂移 TaskSidebar.tsx → 报「16 个状态点 pending(组件未落地)」、enforce 降为 14/14、exit 0 不计失败,还原后复绿。

## 0. 主题机制速览(核对前必读)

- **应用内插件面走 DSH 桥接**:`injectDesignTokens({ bridge: true })`(styles.ts:774,injectWorkbenchStyles 内)把 `--et-*` 映射到 DSH `--dsw-alias-*`(design-tokens §2 表,桥接必须落 body 层)。**深色值取不到 = 桥接写 `:root` 的典型故障**;组件侧唯一责任是只引用 `--et-*`,双主题翻转由令牌层承担。
- **原型 color-mix 透明度口径**:浅底合成(warn 底 88%/95% 透明等)在组件里写 `color-mix(in oklab, var(--et-warn), transparent N%)`,与原型一致;禁止改成写死色值。
- **截图取主题方式**:应用内面跟随产品壳主题——浅色截产品壳默认主题,深色截产品壳切深色后的同屏;不要给工作台单独注入第二套令牌(frontend-style §1-2「任何页面不允许只出一套色」)。
- **状态色必须配文字**(frontend-style §3 徽标行;38 号 S-2):状态点/徽标同屏必须有可读文字,不得只靠颜色。

## 1. T6 任务侧栏(原型一 = `docs/prototypes/01-task-sidebar.html`;实现 `client/TaskSidebar.tsx` + styles.ts:503-660)

### 1.1 状态点词汇表(与 T8 看板同源,styles.ts:141-154 已落地)

| # | 状态点 | 原型 class | 期望令牌 | 实现核对 | 浅色 | 深色 |
|---|---|---|---|---|---|---|
| 1 | 等我处理 person/*(琥珀,脉动) | `.dot.dot-wait-person` (+`.dot-pulse`) | `--et-warn`(脉动 keyframes 同 warn 合成 + `--et-ease`) | styles.ts:143 ✓(keyframes :150-154);组件 TaskSidebar.tsx:62-67、117-122 | ☐ | ☐ |
| 2 | 进行中 working(实心蓝) | `.dot.dot-working` | `--et-accent` | styles.ts:144 ✓ | ☐ | ☐ |
| 3 | 排队中 working/queued(空心蓝) | `.dot.dot-queued` | transparent 底 + 2px `--et-accent` 描边 | styles.ts:145 ✓ | ☐ | ☐ |
| 4 | 空闲 idle(灰) | `.dot.dot-idle` | `--et-meta` | styles.ts:146 ✓ | ☐ | ☐ |
| 5 | 已就绪 ready(绿) | `.dot.dot-ready` | `--et-success` | styles.ts:147 ✓ | ☐ | ☐ |
| 6 | 出错 error(红;全原型统一词汇表成员) | `.dot.dot-error` | `--et-danger` | styles.ts:148 ✓ | ☐ | ☐ |
| 7 | 脉冲动效(reduced-motion 下停跳) | `.dot-pulse`/`@keyframes` | `--et-warn` 合成 + `--et-ease` | styles.ts:149-154 ✓;`prefers-reduced-motion` 全局降级见 §3 行 3 | ☐ | ☐ |

### 1.2 分组与行状态(S-1/S-2/S-3)

| # | 状态点 | 原型依据 | 期望令牌 | 实现核对 | 浅色 | 深色 |
|---|---|---|---|---|---|---|
| 8 | 分组头(标题 + stage 码) | `.task-group-h`/`.stage-code` | `--et-muted`(标题)、`--et-meta`(stage 码) | styles.ts:531-535 + :182 ✓ | ☐ | ☐ |
| 9 | 分组计数徽标三态 | `.badge-warn`/`.badge-accent`/`.badge-muted` | warn:`--et-warn` 合成底;accent:`--et-accent` on `--et-accent-soft`;muted:`--et-muted` on `--et-surface` + `--et-border-soft` | styles.ts:183-186 ✓(通用 badge 词汇 :156-166) | ☐ | ☐ |
| 10 | 工单行默认(标题/副行/chev) | `.t-title`/`.t-meta`/`.chev` | `--et-fg`、`--et-muted`、`--et-meta` | styles.ts:550、:551-554、chev :548 ✓ | ☐ | ☐ |
| 11 | 工单行悬停 | `.task-item:hover` | `--et-surface-2` | styles.ts:543 ✓ | ☐ | ☐ |
| 12 | 工单行当前态(is-active,含分支切换高亮) | `.task-item.is-active` | `--et-accent` 边 + `--et-accent-soft` 底 | styles.ts:544-546 ✓ | ☐ | ☐ |
| 13 | 会话行当前项 | `.session-list a[aria-current='page']` | `--et-accent` + `--et-accent-soft`(hover `--et-surface-2` + `--et-fg`) | styles.ts:520-528 ✓ | ☐ | ☐ |
| 14 | 侧栏容器与分区分隔 | `.side-panel`/`.side-section` | `--et-surface` + `--et-border-soft` | styles.ts:508-513 ✓ | ☐ | ☐ |

### 1.3 会话内表面(S-4 关联;T7 同源)

| # | 状态点 | 原型依据 | 期望令牌 | 实现核对 | 浅色 | 深色 |
|---|---|---|---|---|---|---|
| 15 | 会话内提问卡(一次一问) | `.ask-card`/`.ask-title`/`.ask-q`/`.ask-foot` | warn 边/底(color-mix 60%/95%)、`--et-warn`(标题)、`--et-fg`(问题)、`--et-muted`(脚注) | styles.ts:598-639 ✓(ask-card :599-605、ask-title :606-609、ask-q :610、ask-foot :635-639) | ☐ | ☐ |
| 15★ | 提交回答按钮(提问卡内) | `.reply-row .btn`(原型一实心主操作) | `--et-accent-fill` + `--et-accent-on`,hover `--et-accent-fill-hover` | styles.ts:621-629 ✓(reply-row 作用域实心规则;hover 经块内 `--wb-btn-hover` 引用 `--et-accent-fill-hover`,anchorCheck 收口于 03:34) | ☐ | ☐ |
| 16 | 结果卡 | `.result-card`/`.result-head`/`.file-chip` | `--et-border`、`--et-surface-2` 头底、`--et-fg` 头字、`--et-success` 头图标、`--et-border-soft` chip 边(hover `--et-accent`) | styles.ts:640-656 ✓(result-card :641-644、result-head :645-650、file-chip :591-596) | ☐ | ☐ |
| 17★ | 结果卡动作(验收通过=实心主操作;退回并说明=次操作) | `.result-actions .btn`/`.btn-secondary` | 主操作 `--et-accent-fill` + `--et-accent-on`(hover `--et-accent-fill-hover`);次操作 `--et-border` + `--et-fg-2` | 验收通过 styles.ts:630-634 ✓(result-actions 作用域实心规则,03:34 收口);退回=描边 `btn-secondary`(styles.ts:302-310)✓ | ☐ | ☐ |
| 18 | 多 Assignment 分支切换 chip 行 | S-4 行(38 号 §6.4;O-9 原型缺位——实现按 38 号 O-9 口径复用原型 03 chip 词汇,TaskSidebar.tsx:261-264 注明) | chip 选中态 `--et-accent` + `--et-accent-soft`(styles.ts:122-132)✓;分支状态徽标 tone 词汇(:156-166) | styles.ts/TaskSidebar.tsx:277-294 ✓ | ☐ | ☐ |

## 2. T7 Attention 卡站内横幅(原型二 = `docs/prototypes/02-attention-card.html` 形态一;实现 `client/AttentionBanner.tsx` + styles.ts:662-743)

| # | 状态点 | 原型依据 | 期望令牌 | 实现核对 | 浅色 | 深色 |
|---|---|---|---|---|---|---|
| 1 | 横幅常态(warn 左竖条驻留) | `.attn-banner` | `--et-warn` 边/竖条 + `--et-surface` 底 | styles.ts:663-671 ✓ | ☐ | ☐ |
| 1b | 临近超时/已升级横幅级变体 | `.attn-banner` stage 变体 | warn/danger 边与底随 `data-eterna-workbench-stage` 翻转 | styles.ts:672-679 ✓ | ☐ | ☐ |
| 2 | 「需要你拍板」徽标 | `.badge.badge-warn` | `--et-warn` 字 + warn 合成底 | badge tone warn(styles.ts:164)✓ | ☐ | ☐ |
| 3 | 资金红线 R3 徽标 | `.badge.badge-danger` | `--et-danger` 字 + `--et-danger-soft` 底 | badge tone danger(styles.ts:165)✓ | ☐ | ☐ |
| 4 | 倒计时 · 常态 | `.countdown` | `--et-warn` 字 + warn 合成底胶囊(tabular-nums) | styles.ts:681-687 ✓ | ☐ | ☐ |
| 5 | 倒计时 · 临近超时(强调反白) | `.countdown.is-urgent` | `--et-surface` 字 + `--et-warn` 实底 | styles.ts:688 ✓ | ☐ | ☐ |
| 6 | 倒计时 · 已超时升级 | `.countdown.is-escalated` | `--et-surface` 字 + `--et-danger` 实底 | styles.ts:689 ✓ | ☐ | ☐ |
| 7 | 升级提示行 | `.attn-escalate` | `--et-warn` 字 + dashed warn 分隔(超时升级只加通知不撤工单) | styles.ts:737-742 ✓ | ☐ | ☐ |
| 8 | 单问主文案(A-4 一次一问) | `.attn-q` | `--et-fg` + 20px(text-lead) + `--et-weight-display` | styles.ts:690-693 ✓ | ☐ | ☐ |
| 9 | 元信息/上下文行 | `.attn-meta`/`.attn-context` | `--et-muted` / `--et-fg-2` | styles.ts:694-698 ✓ | ☐ | ☐ |
| 10 | 批准主按钮(R3 双确认=两击) | `.attn-actions .btn` 实心 | `--et-accent-fill` + `--et-accent-on`,hover `--et-accent-fill-hover` | styles.ts:700-707 ✓(两击臂环 :729-735;armed 文案翻转 AttentionBanner.tsx:94-98/114-117) | ☐ | ☐ |
| 11 | 补充说明次按钮 | `.btn.btn-secondary` | `--et-surface` + `--et-border` + `--et-fg-2`,hover `--et-accent` | styles.ts:708-714 ✓ | ☐ | ☐ |
| 12 | 拒绝破坏性文字钮(需一句理由) | `.btn.btn-danger-text` | `--et-danger` 字,hover `--et-danger-soft` 底(不用实底红) | styles.ts:715-721 ✓ | ☐ | ☐ |
| 13 | 回原对话 ghost 钮 | `.btn.btn-ghost` | `--et-muted`,hover `--et-accent` + `--et-accent-soft` | styles.ts:722-728 ✓ | ☐ | ☐ |
| 14 | 动作钮焦点光圈 + 拒绝理由输入 | 全局 `:focus-visible` | `--et-focus-ring`(0 0 0 3px) | styles.ts 全局规则(:50-58)+ :618-620(输入 focus)✓ | ☐ | ☐ |
| 15 | 已解决/消卡态 | `.im-card.is-resolved`(形态二) | `--et-success`(**enforce=false**:渠道卡片渲染归 channels `cards.ts`(A-2),站内横幅答复即移除;若站内实现含解决态回显则对齐本行) | 站内实现无驻留解决面(符合 A-2 口径) | — | — |

## 3. 主题横切项(双组件共同;enforce=true 均已机器化)

| # | 项 | 期望 | 机器核对 | 浅色 | 深色 |
|---|---|---|---|---|---|
| 1 | DSH 桥接 | `injectDesignTokens({ bridge: true })`,桥接落 body 层 | styles.ts `bridge: true` ✓(styles.ts:774;manifest cross:bridge) | ☐ | ☐ |
| 2 | 焦点光圈 | `:focus-visible` 0 0 0 3px | CSS 含 `--et-focus-ring` ✓(styles.ts:56、:139、:620) | ☐ | ☐ |
| 3 | 动效尊重 | `prefers-reduced-motion` 全局降级(dot-pulse 停跳) | CSS 含 `prefers-reduced-motion` ✓(styles.ts:293-298) | ☐ | ☐ |
| 4 | 响应式断点 | 1100/760/640(640 = 移动端可用性承接) | CSS 三断点全在 ✓(横幅动作区 ≤640 纵排 styles.ts:761-764) | ☐ | ☐ |
| 5 | 状态色配文字 | 状态点/徽标同现可读文字 | 机器不可判——本列人工截图核对(badge 词汇 :156-166 均「色字同现」) | ☐ | ☐ |
| 6 | 禁字面色值 | 十六进制只允许 ui/src/tokens.ts(Canvas 令牌兜位豁免:FlowCanvas.tsx,30 号 §7-1②) | G0-2(HEX_ALLOWED)✓ | — | — |

## 4. 机器门禁与报告用法

```bash
# G0-2(verify 链首步;含 workbench 扫描、状态点 enforce 核对、anchorChecks 选择器级精查)
node scripts/lint-ui-tokens.mjs

# 令牌使用报告(逐文件 --et-* 计数 + 状态点核对结果 + 汇总;JSON)
node scripts/lint-ui-tokens.mjs --report artifacts/gates/G0-2/theme-token-report.json

# 包级 verify(含 tests/theme-tokens.spec.ts 状态点断言)
pnpm --filter @eterna/workbench run verify
```

- 状态点契约唯一真值源:`packages/workbench/theme-state-points.json`(`enforce=true` 30 点;组件未落地时 G0-2 报 `pending`、spec 记 skip——落地后自动转强制,不伪造通过)。
- 已验证(2026-11-18 首轮 + S2-T14 行号校正后复跑同日 10:43):①清单注入未定义令牌 → exit 1 逐状态点名(`task-sidebar.dot-ready 清单引用未定义令牌…` + `缺期望令牌…`);②同批注入 anchorCheck 块外令牌 → exit 1 点名选择器(`ask-card … anchorCheck 失败:选择器「reply-row'] [data-eterna-workbench='btn'」块缺期望令牌 --et-danger`);③还原后 exit 0「状态点强制 30/30 通过」(11 目录 165 文件,60 个 `--et-*` 令牌);④暂移 TaskSidebar.tsx → 报「16 个状态点 pending(组件未落地)」、enforce 降 14/14、exit 0 不计失败,还原复绿;⑤报告半:`--report` 落盘 JSON(summary: issues 0 / filesScanned 165 / definedTokens 60 / statePoints enforced 30·ok 30·pending 0·failed 0;逐文件令牌计数中 styles.ts 49 种 568 处引用,两组件 .tsx 内零内联令牌——令牌全走 styles.ts,状态点核对按组件 files 集合合并判定);⑥anchorChecks 兜住文件级查不出的「实心/描边换用」偏差 2 处(见 §1.3 ★,首轮检出并收口)。

## 5. 真实浏览器截图补拍清单(主会话验收阶段;G2-D2)

> 门禁原文要求 `docs/design/prototypes/<id>/prs/<PR号>/{light,dark}.png`(>20KB)+ `docs/design/prototypes/INDEX.md` 登记。**现状差异(实测)**:本仓原型实际在 `docs/prototypes/`(01/02 两件已产,38 号 T1 规格同指);`docs/design/prototypes/` 目录与 `INDEX.md` 均不存在——补拍时按 G2-D2 原文路径与 INDEX.md 行同时落,目录差异在 INDEX.md 登记行注明即可,不在本任务内改门禁定义。

- [ ] T6 侧栏整屏:浅/深 × (分组四档 + 状态点六态 + 计数徽标三态) 同屏,≥1100px 与 640px 各一轮(断点自查)
- [ ] T6 会话内提问卡态(一次一问 + 提交回答钮):浅/深
- [ ] T6 结果卡态(文件 chip + 验收/退回动作):浅/深
- [ ] T6 工单行 hover 与当前态特写 + 分支 chip 行:浅/深
- [ ] T7 横幅常态(倒计时常态 + 四动作区):浅/深
- [ ] T7 临近超时(`is-urgent` 反白)与已超时升级(`is-escalated`)两态特写:浅/深
- [ ] T7 升级提示行 + R3 双确认两击态(第二击出现前/后):浅/深
- [ ] a11y 特写:Tab 焦点光圈(`--et-focus-ring`)、`prefers-reduced-motion` 下状态点停跳
- [ ] 每张 PNG >20KB;INDEX.md 登记 `PR-<n>` 行(含目录差异注)

## 6. 与门禁的对应关系

| 本清单章节 | 门禁 | 判据 |
|---|---|---|
| §1/§2/§3 状态点令牌核对 | 38 号 T14 依据 30 号 §4-2(G-3) | G0-2 exit 0 + theme-tokens.spec 全绿(本轮 30/30 已绿) |
| §1.3 ★ 实心主操作(anchorChecks) | 38 号 T6「实现不得偏离原型」 | 首轮检出偏差 → T6/T7 作用域实心规则收口 → G0-2 复跑 exit 0 |
| §5 截图矩阵 | 33 号 G2-D2 | `{light,dark}.png` 存在且 >20KB + INDEX.md 登记(主会话补拍) |
