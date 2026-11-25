---
name: eterna-v4
sources:
  - packages/ui/src/tokens.ts
---

# eterna-v4

Eterna 前端视觉体系 v4「温润如玉」的机读形式。唯一真值是 `packages/ui/src/tokens.ts`（`WEBFLOW_TOKENS_CSS`），规范见 `docs/design/frontend-style.md` 与 `docs/design/42-前端视觉体系v4-温润如玉.md`。本文件由 `import-design-system.mjs` 从令牌 CSS 导出；改令牌请改源文件后重新导入，不要手改数值。

## Colors

| Token | Value | Use |
| --- | --- | --- |
| `--et-bg` | `#f4f2ec` | 宣纸：页面底 |
| `--et-surface` | `#fbfaf6` | 玉面：卡片、面板 |
| `--et-surface-2` | `#efede5` | 凹槽：侧栏、分组、徽标底、悬停底 |
| `--et-surface-3` | `#e6e3d9` | 输入底、玉环轨道 |
| `--et-fg` | `#1b1e1c` | 墨：正文与标题 |
| `--et-fg-2` | `#3c423e` | 次级正文 |
| `--et-muted` | `#5f655f` | 弱化文字：说明、幽灵按钮 |
| `--et-meta` | `#6f756e` | 元信息：表头、时间戳、占位符 |
| `--et-border` | `#dcd8cd` | 结构边框、输入框边框 |
| `--et-border-soft` | `#eae6dc` | 卡片边框、分隔线 |
| `--et-accent` | `#2b6272` | 黛青：唯一强调色（链接、焦点、选中态字色）；每屏可见 ≤ 2 处 |
| `--et-accent-hover` | `#224f5c` | 强调色悬停 |
| `--et-accent-active` | `#1b4049` | 强调色按下 |
| `--et-accent-fill` | `#2b6272` | 主按钮底 |
| `--et-accent-fill-hover` | `#224f5c` | 主按钮悬停底 |
| `--et-accent-on` | `#fbfaf6` | 强调底上的字 |
| `--et-accent-soft` | `rgba(43, 98, 114, 0.1)` | 选中态底、强调徽标底 |
| `--et-success` | `#2d7a55` | 成功（必须配文字或形状） |
| `--et-warn` | `#94661c` | 警告（必须配文字或形状） |
| `--et-warn-soft` | `rgba(148, 102, 28, 0.1)` | 警告徽标底 |
| `--et-danger` | `#a63d2e` | 破坏、失败、未通过；只用字色与描边，不做实心填充 |
| `--et-danger-soft` | `rgba(166, 61, 46, 0.1)` | 危险徽标底 |
| `--et-jade` | `#3f7d6a` | 青玉：图形专用（完成态圆点、通过环） |
| `--et-sand` | `#c2a179` | 砂：图形专用（条带峰值、次要序列） |
| `--et-scrim` | `rgba(22, 25, 23, 0.42)` | 弹窗遮罩 |
| `--et-selection` | `rgba(43, 98, 114, 0.22)` | 文本选区 |
| `--et-overlay` | `rgba(22, 25, 23, 0.42)` | 遮罩（兼容别名） |
| `--et-bg ([data-eterna-theme='dark'])` | `#161917` | 深色页面底（墨玉，不用纯黑） |
| `--et-surface ([data-eterna-theme='dark'])` | `#1d211f` | 深色卡片、面板 |
| `--et-surface-2 ([data-eterna-theme='dark'])` | `#242826` | 深色凹槽 |
| `--et-surface-3 ([data-eterna-theme='dark'])` | `#2c312e` | 深色输入底 |
| `--et-fg ([data-eterna-theme='dark'])` | `#eceee9` | 深色正文 |
| `--et-fg-2 ([data-eterna-theme='dark'])` | `#c4c9c2` | 深色次级正文 |
| `--et-muted ([data-eterna-theme='dark'])` | `#9aa096` | 深色弱化文字 |
| `--et-meta ([data-eterna-theme='dark'])` | `#8b9188` | 深色元信息 |
| `--et-border ([data-eterna-theme='dark'])` | `#333835` | 深色结构边框 |
| `--et-border-soft ([data-eterna-theme='dark'])` | `#272b29` | 深色卡片边框 |
| `--et-accent ([data-eterna-theme='dark'])` | `#7fb2bd` | 深色强调色 |
| `--et-accent-hover ([data-eterna-theme='dark'])` | `#9cc7d0` | 深色强调色悬停 |
| `--et-accent-active ([data-eterna-theme='dark'])` | `#6ba3af` | 深色强调色按下 |
| `--et-accent-fill ([data-eterna-theme='dark'])` | `#39727f` | 深色主按钮底 |
| `--et-accent-fill-hover ([data-eterna-theme='dark'])` | `#43828f` | 深色主按钮悬停底 |
| `--et-accent-on ([data-eterna-theme='dark'])` | `#f7fbfc` | 深色强调底上的字 |
| `--et-accent-soft ([data-eterna-theme='dark'])` | `rgba(127, 178, 189, 0.16)` | 深色选中态底 |
| `--et-success ([data-eterna-theme='dark'])` | `#6cc294` | 深色成功 |
| `--et-warn ([data-eterna-theme='dark'])` | `#dfae62` | 深色警告 |
| `--et-warn-soft ([data-eterna-theme='dark'])` | `rgba(223, 174, 98, 0.14)` | 深色警告徽标底 |
| `--et-danger ([data-eterna-theme='dark'])` | `#e08a7b` | 深色危险字色 |
| `--et-danger-soft ([data-eterna-theme='dark'])` | `rgba(224, 138, 123, 0.14)` | 深色危险徽标底 |
| `--et-jade ([data-eterna-theme='dark'])` | `#5f9b86` | 深色完成态图形 |
| `--et-sand ([data-eterna-theme='dark'])` | `#a98a63` | 深色条带峰值 |
| `--et-scrim ([data-eterna-theme='dark'])` | `rgba(8, 10, 9, 0.62)` | 深色遮罩 |
| `--et-selection ([data-eterna-theme='dark'])` | `rgba(127, 178, 189, 0.26)` | 深色文本选区 |
| `--et-overlay ([data-eterna-theme='dark'])` | `rgba(8, 10, 9, 0.62)` | 深色遮罩（兼容别名） |

## Fonts

| Token | Value | Use |
| --- | --- | --- |
| `--et-font-display` | `"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", Georgia, serif` | 宋体：只用于页面与分区标题、强调数字；每行 ≤ 20 字；字重 600 |
| `--et-font-body` | `"PingFang SC", "HarmonyOS Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, sans-serif` | 黑体：正文与界面文字；字重 400，强调 500 |
| `--et-font-mono` | `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace` | 等宽：代码、YAML、标识 key |

## Spacing

| Token | Value | Use |
| --- | --- | --- |
| `--et-space-1` | `4px` | 图标与文字间隙 |
| `--et-space-2` | `8px` | 紧凑间距、徽标内距 |
| `--et-space-3` | `12px` | 输入内距、小按钮内距 |
| `--et-space-4` | `16px` | 卡内分组内距、按钮内距 |
| `--et-space-5` | `20px` | 一级卡内距 |
| `--et-space-6` | `24px` | 弹窗内距、区块间距 |
| `--et-space-7` | `28px` | 大区块间距 |
| `--et-space-8` | `32px` | 分页间距 |
| `--et-space-12` | `48px` | 大留白 |
| `--et-space-24` | `96px` | 页面首尾留白 |
| `--et-gutter` | `24px` | 页面内距（≥768 为 24，<768 为 16，见规范 §5.2） |

## Radii

| Token | Value | Use |
| --- | --- | --- |
| `--et-radius-xs` | `8px` | 最小容器（同心弧向下取整时使用） |
| `--et-radius-sm` | `12px` | 输入、小控件、菜单项 |
| `--et-radius-md` | `16px` | 卡片、行卡、按钮 |
| `--et-radius-lg` | `22px` | 卡内强调容器、浮层菜单、输入卡 |
| `--et-radius-xl` | `28px` | 弹窗 |
| `--et-radius-2xl` | `36px` | 全高侧栏、大面板 |
| `--et-radius-pill` | `9999px` | 徽标、胶囊、状态点 |

## Usage

- 令牌唯一：颜色、字号、间距、圆角、阴影、动效只允许 `--et-*`；字面 px 圆角一律打回。
- 同心弧强制：嵌套容器满足「子圆角 = 父圆角 − 内距」，向下取整到阶梯（例：父 22、内距 8 → 子取 12）。
- 字重只有三档：正文 400、强调 500、标题 600；正文出现 500 即打回。
- 强调色预算：每屏可见的黛青 ≤ 2 处（主按钮计 1，选中态计 1）。
- 状态必须「色 + 形 + 字」三重表达；语义色不做大面积底色。
- 双主题：`[data-eterna-theme='light']` 与 `[data-eterna-theme='dark']` 两套都要出，不允许只出一套色。
- 共享基础件的 class 契约在 `packages/ui/src/components-css.ts`（`.et-btn` / `.et-input` / `.et-card` / `.et-badge` / `.et-ring` / `.et-strip` 等），作用域为 `[data-eterna-ui]`。
