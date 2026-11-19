# Eterna 设计令牌表（v4 温润如玉）

> 唯一事实源：`packages/ui/src/tokens.ts`。本文只做映射说明，不重复实现。
> 组件一律引用 `--et-*`；应用内插件面由 `DSH_BRIDGE_CSS` 桥接到 DSH 主题。
>
> **状态（2026-11-19）**：v4 令牌已定稿于
> [42 号规范](42-前端视觉体系v4-温润如玉.md) §2–§5，但 `tokens.ts` 仍是 v3
> 实值，直到 [45 号计划](45-前端v4迁移开发计划.md) P0 合入。§1 的 v3 表保留
> 到 P0 为止；迁移映射见 42 号 §10.1。

## 0. v4 值（P0 后生效，当前未落盘）

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| `--et-bg` | `#f4f2ec` | `#161917` |
| `--et-surface` | `#fbfaf6` | `#1e2320` |
| `--et-surface-2` | `#efede5` | `#242a26` |
| `--et-surface-3` | `#e6e3d9` | `#2b322d` |
| `--et-fg` | `#1b1e1c` | `#eceee8` |
| `--et-fg-2` | `#3c423e` | `#c3c9c1` |
| `--et-muted` | `#5f655f` | `#9aa199` |
| `--et-meta` | `#6f756e` | `#858c84` |
| `--et-border` | `#dcd8cd` | `#333a36` |
| `--et-border-soft` | `#eae6dc` | `#272e2a` |
| `--et-accent` | `#2b6272` | `#7fb2bd` |
| `--et-jade`（图形） | `#3f7d6a` | `#6fae95` |
| `--et-sand`（图形） | `#c2a179` | `#d8bb95` |
| `--et-warn` | `#94661c` | `#d8a94e` |
| `--et-danger` | `#a63d2e` | `#e08373` |

圆角阶梯：`xs 8 / sm 12 / md 16 / lg 22 / xl 28 / 2xl 36 / pill`。
字阶：`micro 11 / caption 13 / body 15 / lead 20 / h3 24 / h2 32 / h1 40 / hero 64`。
阴影：`r1..r4`（暖底），删除 v3 五层级联 `--et-shadow-raised`。

---

## 1. 品牌层（v3 实值，P0 前有效）

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--et-bg` | `#ffffff` | `#080808` | 页面画布 |
| `--et-surface` | `#ffffff` | `#101010` | 卡片/面板 |
| `--et-surface-2` | `#f7f7f7` | `#161616` | 次级面/悬停 |
| `--et-fg` | `#080808` | `#f5f5f5` | 主文字 |
| `--et-fg-2` | `#363636` | `#d4d4d4` | 正文 |
| `--et-muted` | `#5a5a5a` | `#a3a3a3` | 辅助文字 |
| `--et-meta` | `#ababab` | `#737373` | 占位/极弱 |
| `--et-border` | `#d8d8d8` | `#2a2a2a` | 结构边框 |
| `--et-border-soft` | `#ebebeb` | `#1e1e1e` | 行分隔 |
| `--et-accent` | `#146ef5` | `#3b89ff` | 链接/焦点/强调文字 |
| `--et-accent-hover` | `#0055d4` | `#6aa6ff` | 文字悬停 |
| `--et-accent-fill` | `#146ef5` | `#2a6fd0` | 实心按钮/头像底色 |
| `--et-accent-fill-hover` | `#0055d4` | `#1f5bb0` | 实心按钮悬停 |
| `--et-success` | `#00a81a` | `#35e35f` | 成功 |
| `--et-warn` | `#b87300` | `#ffb020` | 警告 |
| `--et-danger` | `#d3122b` | `#ff4d5f` | 错误/破坏性 |

## 2. DSH 桥接（应用内插件面）

| 品牌令牌 | DSH 语义令牌 |
| --- | --- |
| `--et-bg` | `--dsw-alias-bg-base` |
| `--et-surface` | `--dsw-alias-bg-layer-1` |
| `--et-surface-2` | `--dsw-alias-bg-layer-2` |
| `--et-fg` | `--dsw-alias-label-primary` |
| `--et-fg-2` | `--dsw-alias-label-secondary` |
| `--et-muted` | `--dsw-alias-label-tertiary` |
| `--et-meta` | `--dsw-alias-label-dimmed` |
| `--et-border` | `--dsw-alias-border-l2` |
| `--et-border-soft` | `--dsw-alias-border-l1` |
| `--et-accent` | `--dsw-alias-state-business-primary` |
| `--et-success` | `--dsw-alias-state-success-primary` |
| `--et-warn` | `--dsw-alias-state-warn-primary` |
| `--et-danger` | `--dsw-alias-state-error-primary` |

桥接声明必须落在 `body`（或 `[data-eterna-ui]`）：DSH 把 `--dsw-alias-*` 定义在
`body` 而非 `:root`，写在 `:root` 会在深色主题下取不到值、退回 Webflow 浅色兜底。

新增桥接前必须先在上游 `dsh-web-frontend` 样式中确认令牌存在；禁止猜测名称。

## 3. 非颜色令牌

| 类别 | 值 |
| --- | --- |
| 字体 | `--et-font-display` / `--et-font-body` / `--et-font-mono` |
| 字号 | `12 / 14 / 16 / 20 / 24 / 32 / 56` |
| 行高 | `1.04 / 1.3 / 1.6` |
| 字重 | `500 / 600` |
| 间距 | `4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 96` |
| 圆角 | `4 / 8 / 9999` |
| 动效 | `150ms / 200ms / cubic-bezier(0.2,0,0,1)` |
| 容器 | 主面板与设置弹窗全宽（桌面近全屏）/ 登录页全页双栏 / 表单卡 460 |
| 焦点 | `0 0 0 3px color-mix(accent, transparent 70%)` |

## 4. 使用约定

- 组件样式不得写死色值；独立页也不能绕开令牌。
- 深色是同一 schema 的派生，不是第二套设计系统。
- 强调色每屏最多一个主操作 + 一个选中/焦点；二级色只用于数据与插画。
- 表格、代码块等密集内容可用 14/12px；正文与说明保持 16px。
