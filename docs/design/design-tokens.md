# Eterna 设计令牌表（Webflow v1）

> 唯一事实源：`packages/ui/src/tokens.ts`。本文只做映射说明，不重复实现。
> 组件一律引用 `--et-*`；应用内插件面由 `DSH_BRIDGE_CSS` 桥接到 DSH 主题。

## 1. 品牌层（独立页直接使用）

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
| 容器 | `1200 / 960 / 720 / 440` |
| 焦点 | `0 0 0 3px color-mix(accent, transparent 70%)` |

## 4. 使用约定

- 组件样式不得写死色值；独立页也不能绕开令牌。
- 深色是同一 schema 的派生，不是第二套设计系统。
- 强调色每屏最多一个主操作 + 一个选中/焦点；二级色只用于数据与插画。
- 表格、代码块等密集内容可用 14/12px；正文与说明保持 16px。
