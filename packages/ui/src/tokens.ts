/**
 * Eterna 统一设计令牌（v4「温润如玉」产品化版本）。
 *
 * 两层结构：
 * 1. 品牌层（`--et-*`）：宣纸/墨玉画布、黛青单强调色、8→36 圆角阶梯、
 *    四级暖调柔影、15px 正文。独立页（登录/扩展设置）直接使用。
 * 2. 宿主桥接层：应用内插件面把 `--et-*` 映射到 DSH 官方语义令牌，主题
 *    跟随产品壳。桥接只引用上游真实存在的 `--dsw-alias-*`（108 个别名
 *    全部定义在 `body` / `body[data-ds-dark-theme]` 上，见 ui-theme 插件）。
 *
 * 所有十六进制色值只允许出现在本文件；组件样式一律引用变量。
 * 规范：docs/design/42-前端视觉体系v4-温润如玉.md、docs/design/frontend-style.md
 */

import { COMPONENT_CSS } from './components-css.ts'

const LIGHT = `
  color-scheme: light;

  /* 中性（暖玉阶，无冷灰）——画布是宣纸，不是纯白 */
  --et-bg: #f4f2ec;
  --et-surface: #fbfaf6;
  --et-surface-2: #efede5;
  --et-surface-3: #e6e3d9;
  --et-fg: #1b1e1c;
  --et-fg-2: #3c423e;
  --et-muted: #5f655f;
  --et-meta: #6f756e;
  --et-border: #dcd8cd;
  --et-border-soft: #eae6dc;

  /* 主色：黛青（唯一强调色：链接/焦点/主按钮/选中） */
  --et-accent: #2b6272;
  --et-accent-hover: #224f5c;
  --et-accent-active: #1b4049;
  --et-accent-fill: #2b6272;
  --et-accent-fill-hover: #224f5c;
  --et-accent-on: #fbfaf6;
  --et-accent-soft: rgba(43, 98, 114, 0.1);

  /* 语义色（必须配文字或形状，不做大面积底色） */
  --et-success: #2d7a55;
  --et-warn: #94661c;
  --et-warn-soft: rgba(148, 102, 28, 0.1);
  --et-danger: #a63d2e;
  --et-danger-soft: rgba(166, 61, 46, 0.1);

  /* 图形专用色（只说明数据，不进文案层） */
  --et-jade: #3f7d6a;
  --et-sand: #c2a179;

  /* 材质：玉质斜面（每屏 ≤1 处）+ 四级暖调柔影 */
  --et-bevel: inset 0 1px 0 rgba(255, 255, 255, 0.72), inset 0 0 0 1px rgba(255, 255, 255, 0.26);
  --et-shadow-r1: 0 1px 2px rgba(38, 42, 36, 0.05), 0 2px 6px rgba(38, 42, 36, 0.04);
  --et-shadow-r2: 0 1px 2px rgba(38, 42, 36, 0.05), 0 8px 24px rgba(38, 42, 36, 0.07);
  --et-shadow-r3: 0 2px 6px rgba(38, 42, 36, 0.07), 0 16px 40px rgba(38, 42, 36, 0.1);
  --et-shadow-r4: 0 4px 12px rgba(38, 42, 36, 0.09), 0 24px 64px rgba(38, 42, 36, 0.18);
  --et-scrim: rgba(22, 25, 23, 0.42);

  --et-focus-ring: 0 0 0 3px rgba(43, 98, 114, 0.22);
  --et-selection: rgba(43, 98, 114, 0.22);
  --et-overlay: rgba(22, 25, 23, 0.42);
`

const DARK = `
  color-scheme: dark;

  /* 墨玉，不用纯黑：保留绿灰底调 */
  --et-bg: #161917;
  --et-surface: #1d211f;
  --et-surface-2: #242826;
  --et-surface-3: #2c312e;
  --et-fg: #eceee9;
  --et-fg-2: #c4c9c2;
  --et-muted: #9aa096;
  --et-meta: #8b9188;
  --et-border: #333835;
  --et-border-soft: #272b29;

  --et-accent: #7fb2bd;
  --et-accent-hover: #9cc7d0;
  --et-accent-active: #6ba3af;
  --et-accent-fill: #39727f;
  --et-accent-fill-hover: #43828f;
  --et-accent-on: #f7fbfc;
  --et-accent-soft: rgba(127, 178, 189, 0.16);

  --et-success: #6cc294;
  --et-warn: #dfae62;
  --et-warn-soft: rgba(223, 174, 98, 0.14);
  --et-danger: #e08a7b;
  --et-danger-soft: rgba(224, 138, 123, 0.14);

  --et-jade: #5f9b86;
  --et-sand: #a98a63;

  /* 深色阴影加深但降低不透明度，靠 bevel 与边框提亮 */
  --et-bevel: inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  --et-shadow-r1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --et-shadow-r2: 0 2px 6px rgba(0, 0, 0, 0.34), 0 10px 28px rgba(0, 0, 0, 0.24);
  --et-shadow-r3: 0 4px 12px rgba(0, 0, 0, 0.4), 0 18px 44px rgba(0, 0, 0, 0.34);
  --et-shadow-r4: 0 8px 20px rgba(0, 0, 0, 0.46), 0 28px 72px rgba(0, 0, 0, 0.5);
  --et-scrim: rgba(8, 10, 9, 0.62);

  --et-focus-ring: 0 0 0 3px rgba(127, 178, 189, 0.26);
  --et-selection: rgba(127, 178, 189, 0.26);
  --et-overlay: rgba(8, 10, 9, 0.62);
`

/**
 * 两个主题共用的形状与排版。注意 v4 变化：
 * - `--et-weight-body` 从 500 降到 400（全站 500 是 v3 最重的模板感来源）
 * - 圆角从 4/8 两档扩到 8/12/16/22/28/36 六档（同心弧是强制规则）
 * - `--et-shadow-raised` 保留为兼容别名，指向 r2；新代码用 r1..r4
 */
const SHARED = `
  /* 标题用宋、正文用黑：宋体只用于页面/分区标题与强调数字 */
  --et-font-display: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", Georgia, serif;
  --et-font-body: "PingFang SC", "HarmonyOS Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, sans-serif;
  --et-font-mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;

  --et-text-micro: 11px;
  --et-text-meta: 12px;
  --et-text-caption: 13px;
  --et-text-body: 15px;
  --et-text-lead: 17px;
  --et-text-h3: 22px;
  --et-text-h2: 28px;
  --et-text-h1: 40px;
  --et-text-hero: 64px;
  --et-leading-body: 1.7;
  --et-leading-tight: 1.05;
  --et-leading-snug: 1.35;
  --et-tracking-display: 0;
  --et-tracking-caps: 0.08em;
  --et-weight-body: 400;
  --et-weight-emphasis: 500;
  --et-weight-display: 600;

  --et-space-1: 4px;
  --et-space-2: 8px;
  --et-space-3: 12px;
  --et-space-4: 16px;
  --et-space-5: 20px;
  --et-space-6: 24px;
  --et-space-7: 28px;
  --et-space-8: 32px;
  --et-space-12: 48px;
  --et-space-24: 96px;

  /* 圆角阶梯：子 = 父 − 内距，向下取最近档 */
  --et-radius-xs: 8px;
  --et-radius-sm: 12px;
  --et-radius-md: 16px;
  --et-radius-lg: 22px;
  --et-radius-xl: 28px;
  --et-radius-2xl: 36px;
  --et-radius-pill: 9999px;

  --et-motion-fast: 120ms;
  --et-motion-base: 220ms;
  --et-motion-enter: 380ms;
  --et-ease: cubic-bezier(0.22, 0.61, 0.24, 1);

  --et-container: 1200px;
  /* 主面板与设置弹窗默认全宽；保留一个可选阅读上限，避免未来页面重新缩回窄列。 */
  --et-container-panel: 1600px;
  --et-gutter: 24px;

  /* 四级暖调柔影（浅色基准值；桥接块内会按主题覆盖为深色值）。
     必须放 SHARED：否则只用桥接模式时取不到，阴影会退回浏览器默认/深色值。 */
  --et-shadow-r1: 0 1px 2px rgba(38, 42, 36, 0.05), 0 2px 6px rgba(38, 42, 36, 0.04);
  --et-shadow-r2: 0 1px 2px rgba(38, 42, 36, 0.05), 0 8px 24px rgba(38, 42, 36, 0.07);
  --et-shadow-r3: 0 2px 6px rgba(38, 42, 36, 0.07), 0 16px 40px rgba(38, 42, 36, 0.1);
  --et-shadow-r4: 0 4px 12px rgba(38, 42, 36, 0.09), 0 24px 64px rgba(38, 42, 36, 0.18);
  --et-warn-soft: rgba(148, 102, 28, 0.1);
  --et-jade: #3f7d6a;
  --et-sand: #c2a179;

  /* 兼容别名：v3 代码仍引用 --et-shadow / --et-shadow-raised，指向 v4 档位 */
  --et-shadow: 0 1px 2px rgba(38, 42, 36, 0.05), 0 8px 24px rgba(38, 42, 36, 0.07);
  --et-shadow-raised: 0 1px 2px rgba(38, 42, 36, 0.05), 0 8px 24px rgba(38, 42, 36, 0.07);
`

/** 品牌层（独立页直接使用；深色跟随系统，或由 data-eterna-theme 强制）。 */
export const WEBFLOW_TOKENS_CSS = `
:root, [data-eterna-theme='light'] {${LIGHT}${SHARED}}
@media (prefers-color-scheme: dark) {
  :root:not([data-eterna-theme='light']) {${DARK}}
}
[data-eterna-theme='dark'] {${DARK}}
`

/**
 * 宿主桥接：把品牌令牌映射到 DSH 官方语义令牌，主题跟随产品壳。
 *
 * 关键约束（实测，勿改）：
 * - DSH 把 108 个 `--dsw-alias-*` 定义在 `body` 与 `body[data-ds-dark-theme]`
 *   上（不是 `:root`，也没有 `prefers-color-scheme`）。桥接必须同层声明，
 *   否则 var() 在浅色侧取不到深色值、深色主题会退回浅色兜底。
 * - v4 反向覆盖：v3 是"产品色跟随宿主中性色"，那样暖玉永远显示不出来。
 *   这里改为在 `body` 上重定义宿主的中性/语义别名，让宿主壳（侧栏、顶栏、
 *   输入区、消息气泡）整体变暖，而不是逐组件打补丁。
 * - 宿主不提供实心按钮底：`--et-accent-fill` 由 accent 混黑 38% 本地派生，
 *   保证白字 ≥4.5:1。深色下混黑会更暗，所以深色走 `--et-accent-fill` 兜底值。
 */
export const DSH_BRIDGE_CSS = `
/*
 * 选择器用 html body 而不是 body：宿主主题插件同样在 body 上定义这批
 * --dsw-alias-*,而它的样式表在客户端 bundle 之后注入——同权重下后写的胜出,
 * 会把这里的暖玉色全部冲回 --dsw-static-neutral-bluish-* 的冷白。
 * 实测(2026-11-19 生产):data-eterna-ui 已落、tokens CSS 已注入,但 --et-bg
 * 解析结果仍是 #fff,正是这个覆盖顺序造成。
 * html body 多一个类型选择器(0,0,2 > 0,0,1),不依赖注入顺序。
 */
html body {
  /* 中性阶梯：宿主静止中性色 → 玉色（浅色侧） */
  --dsw-alias-bg-base: #f4f2ec;
  --dsw-alias-bg-layer-1: #fbfaf6;
  --dsw-alias-bg-layer-2: #efede5;
  --dsw-alias-bg-layer-3: #e6e3d9;
  --dsw-alias-bg-layer-4: #e6e3d9;
  --dsw-alias-bg-module-platform: #efede5;
  --dsw-alias-bg-skeleton: rgba(38, 42, 36, 0.06);
  --dsw-alias-bg-mask-1: rgba(22, 25, 23, 0.26);
  --dsw-alias-border-l1: #eae6dc;
  --dsw-alias-border-l2: #dcd8cd;
  --dsw-alias-border-l3: #dcd8cd;
  --dsw-alias-border-l4: #cdc7ba;
  --dsw-alias-label-primary: #1b1e1c;
  --dsw-alias-label-secondary: #3c423e;
  --dsw-alias-label-tertiary: #5f655f;
  --dsw-alias-label-dimmed: #6f756e;
  --dsw-alias-label-caption: #6f756e;
  --dsw-alias-label-primary-foreground: #fbfaf6;
  --dsw-alias-label-primary-inverted: #fbfaf6;
  --dsw-alias-menu-icon: #3c423e;
  --dsw-alias-menu-group-header-fill: #f4f2ec;
  --dsw-alias-button-elevated-fill: #fbfaf6;
  --dsw-alias-button-floating-fill: #fbfaf6;
  --dsw-alias-button-floating-hover: #efede5;
  --dsw-alias-button-ghost-active-fill: #efede5;
  --dsw-alias-button-ghost-active-hover: #e6e3d9;
  --dsw-alias-button-ghost-active-border: #cdc7ba;
  --dsw-alias-button-primary-dimmed: #efede5;
  --dsw-alias-interactive-bg-hover: rgba(38, 42, 36, 0.05);
  --dsw-alias-interactive-bg-active: rgba(38, 42, 36, 0.09);
  --dsw-alias-interactive-bg-hover-solid: #efede5;
  --dsw-alias-scrollbar-bg-l2: rgba(38, 42, 36, 0.12);
  --dsw-alias-scrollbar-hover-l2: rgba(38, 42, 36, 0.24);
  --dsw-alias-markdown-code-block: #efede5;
  --dsw-alias-markdown-code-block-banner: #e6e3d9;
  --dsw-alias-markdown-inline-code: #efede5;
  --dsw-alias-markdown-tag: #efede5;
  --dsw-alias-markdown-citation: #efede5;
  --dsw-alias-turn-trigger-bg: #efede5;
  --dsw-alias-turn-trigger-bg-hover: #e6e3d9;
  --dsw-alias-border-l2-darkmode-thin: #dcd8cd;
  --dsw-alias-button-tool-bar-fill: rgba(38, 42, 36, 0.28);
  --dsw-alias-button-tool-bar-hover: rgba(38, 42, 36, 0.4);
  --dsw-alias-switch-thumb: #fbfaf6;
  --dsw-alias-label-shimmer: rgba(38, 42, 36, 0.12);
  --dsw-alias-code-diff-added: rgba(45, 122, 85, 0.12);
  --dsw-alias-code-diff-deleted: rgba(166, 61, 46, 0.12);

  /* 强调：宿主 business-primary（电光蓝）→ 黛青 */
  --dsw-alias-state-business-primary: #2b6272;
  --dsw-alias-state-business-tertiary: rgba(43, 98, 114, 0.1);
  --dsw-alias-link: #2b6272;
  --dsw-alias-button-primary-fill: #2b6272;
  --dsw-alias-button-primary-hover: #224f5c;
  --dsw-alias-interactive-bg-hover-accent: rgba(43, 98, 114, 0.14);
  --dsw-alias-label-primary-bluish: #1b1e1c;

  /* 语义：去掉高饱和 */
  --dsw-alias-state-success-primary: #2d7a55;
  --dsw-alias-state-success-tertiary: rgba(45, 122, 85, 0.1);
  --dsw-alias-state-warn-primary: #94661c;
  --dsw-alias-state-warn-label: #94661c;
  --dsw-alias-state-warn-tertiary: rgba(148, 102, 28, 0.1);
  --dsw-alias-state-error-primary: #a63d2e;
  --dsw-alias-interactive-bg-hover-danger: rgba(166, 61, 46, 0.08);
  --dsw-alias-label-error: #a63d2e;
  --dsw-alias-state-idle-primary: #cdc7ba;
  --dsw-alias-state-done-primary: #3f7d6a;

  /* 浮层：暖调深墨，与宣纸同族 */
  --dsw-alias-toast-bg: #2c312e;
  --dsw-alias-toast-label: #fbfaf6;
  --dsw-alias-tooltip-bg: #2c312e;
  --dsw-alias-tooltip-key-bg: #454b47;

  /* 品牌字形与强调光标（上游原值为 DeepSeek 蓝，不换会残留电光色） */
  --dsw-alias-brand-primary: #1b1e1c;
  --dsw-alias-brand-text: #1b1e1c;
  --dsw-alias-brand-primary-new-colorprimary-new-color: #2b6272;

  /* ── 补漏：宿主 108 个别名里我们先前只覆盖了 72 个 ──────────────
     漏掉的那批全部指向 --dsw-static-* 原始色板，于是漏一个就漏一处
     电光蓝/冷白。实测(2026-11-19 生产)：输入框发送按钮读
     --dsw-alias-button-info-fill(= #4176e6 电光蓝)，一直是蓝的；
     文档预览、多选底、滚动条、设置卡描边同理。这里逐条补上。 */
  --dsw-alias-button-info-fill: #2b6272;
  --dsw-alias-button-info-hover: #224f5c;
  --dsw-alias-button-contrast-fill: #1b1e1c;
  --dsw-alias-button-tool-bar-fill-invisible: rgba(38, 42, 36, 0);
  --dsw-alias-bg-overlay: #fbfaf6;
  --dsw-alias-bg-mask-2: rgba(22, 25, 23, 0.16);
  --dsw-alias-bg-mask-3: rgba(22, 25, 23, 0.48);
  --dsw-alias-bg-mask-drop: rgba(22, 25, 23, 0.32);
  --dsw-alias-bg-mask-photo: rgba(22, 25, 23, 0.55);
  --dsw-alias-bg-multi-select: #efede5;
  --dsw-alias-bg-document-preview: #efede5;
  --dsw-alias-bg-document-selection: rgba(43, 98, 114, 0.22);
  --dsw-alias-border-inverted: rgba(0, 0, 0, 0);
  --dsw-alias-border-inverted2: rgba(0, 0, 0, 0);
  --dsw-alias-brand-primary-invert: #fbfaf6;
  --dsw-alias-label-primary-dimmed: #1b1e1c;
  --dsw-alias-label-document-preview: #3c423e;
  --dsw-alias-label-deep-diving: #5f655f;
  --dsw-alias-label-deep-diving-shimmer: rgba(38, 42, 36, 0.12);
  --dsw-alias-markdown-placeholder: #efede5;
  --dsw-alias-markdown-code-segment-selected: #e6e3d9;
  --dsw-alias-markdown-code-segment-unselected: #fbfaf6;
  --dsw-alias-settings-card-fill: #fbfaf6;
  --dsw-alias-settings-card-stroke: #eae6dc;
  --dsw-alias-onboarding-accent: #2b6272;
  --dsw-alias-onboarding-card-fill: #fbfaf6;
  --dsw-alias-onboarding-secondary-fill: #efede5;
  --dsw-alias-onboarding-checkbox-border: #cdc7ba;
  --dsw-alias-scrollbar-bg-l1: rgba(38, 42, 36, 0.1);
  --dsw-alias-scrollbar-hover-l1: rgba(38, 42, 36, 0.22);
  --dsw-alias-state-success-secondary: #2d7a55;
  --dsw-alias-state-error-secondary: #a63d2e;
  --dsw-alias-state-warn-secondary: #94661c;
  --dsw-alias-file-diff-added-bg: rgba(45, 122, 85, 0.1);
  --dsw-alias-file-diff-added-gutter: rgba(45, 122, 85, 0.16);
  --dsw-alias-file-diff-added-marker: #2d7a55;
  --dsw-alias-file-diff-deleted-bg: rgba(166, 61, 46, 0.1);
  --dsw-alias-file-diff-deleted-gutter: rgba(166, 61, 46, 0.16);
  --dsw-alias-file-diff-deleted-marker: #a63d2e;
  --dsw-alias-illustration-background: #efede5;
  --dsw-alias-illustration-backing: #e6e3d9;
  --dsw-alias-illustration-detail: #c2a179;
  --dsw-alias-illustration-inset: #fbfaf6;
  --dsw-alias-illustration-shadow: rgba(38, 42, 36, 0.08);
  --dsw-alias-illustration-surface: #fbfaf6;

  /* rc.5 新增别名：浮层（tooltip 标签/toast 动作/悬停卡）、卡片砖面、
     JSON 树语法色、图表三色、轨迹强调。宿主升级后这批开始按名取值，
     不覆盖就退回静态色板的纯白/电光蓝/原色语法。 */
  --dsw-alias-tooltip-label: #fbfaf6;
  --dsw-alias-toast-action: #a0c2ca;
  --dsw-alias-hovercard-bg: #2c312e;
  --dsw-alias-hovercard-label-primary: #fbfaf6;
  --dsw-alias-hovercard-label-secondary: #d3cec2;
  --dsw-alias-hovercard-label-tertiary: #b3ada1;
  --dsw-alias-hovercard-state-done: #7d6c9e;
  --dsw-alias-hovercard-state-error: #b9553f;
  --dsw-alias-card-fill: #f7f5ef;
  --dsw-alias-card-fill-hover: #efede5;
  --dsw-alias-card-tile-fill: rgba(251, 250, 246, 0.7);
  --dsw-alias-border-selected: #8f8a80;
  --dsw-alias-label-on-color: #fbfaf6;
  --dsw-alias-trajectory-accent: #2b6272;
  --dsw-alias-chart-messages: #548697;
  --dsw-alias-chart-system: #b3ada1;
  --dsw-alias-chart-tools: #7d6c9e;
  --dsw-alias-json-tree-property: #61527d;
  --dsw-alias-json-tree-string: #a63d2e;
  --dsw-alias-json-tree-number: #2b6272;
  --dsw-alias-json-tree-keyword: #2b6272;
  --dsw-alias-json-tree-punctuation: #1b1e1c;
  --dsw-alias-json-tree-icon: #5f655f;
  --dsw-alias-json-tree-hover: rgba(38, 42, 36, 0.06);

  /* ── 兜底层：静态色板本身 ──────────────────────────────────────
     别名只是指针，真正定义颜色的是这 82 个 --dsw-static-*。宿主组件里
     还有一批地方直接读静态令牌（不经过别名层），漏一个就是一处电光蓝。
     把整个色板重映射到玉色族，等价于关掉上游默认皮肤——以后宿主新增
     别名时，即便我们没逐条覆盖，底层色也不会漏出冷白/电光蓝。 */

  /* 冷白中性 → 宣纸/玉面/凹槽阶梯（数值越大越深） */
  --dsw-static-neutral-bluish-00: #fbfaf6;
  --dsw-static-neutral-bluish-50: #f7f5ef;
  --dsw-static-neutral-bluish-55: #f4f2ec;
  --dsw-static-neutral-bluish-60: #f4f2ec;
  --dsw-static-neutral-bluish-75: #efede5;
  --dsw-static-neutral-bluish-90: #efede5;
  --dsw-static-neutral-bluish-100: #eae6dc;
  --dsw-static-neutral-bluish-150: #e6e3d9;
  --dsw-static-neutral-bluish-200: #dcd8cd;
  --dsw-static-neutral-bluish-300: #d3cec2;
  --dsw-static-neutral-bluish-310: #d3cec2;
  --dsw-static-neutral-bluish-400: #b3ada1;
  --dsw-static-neutral-bluish-500: #8f8a80;
  --dsw-static-neutral-bluish-600: #6f756e;
  --dsw-static-neutral-bluish-700: #5f655f;
  --dsw-static-neutral-bluish-750: #4b514c;
  --dsw-static-neutral-bluish-800: #3c423e;
  --dsw-static-neutral-bluish-850: #2c312e;
  --dsw-static-neutral-bluish-875: #242826;
  --dsw-static-neutral-bluish-900: #1d211f;
  --dsw-static-neutral-bluish-950: #161917;
  --dsw-static-neutral-bluish-1000: #0f1210;

  /* 纯灰阶 → 同阶梯的暖灰 */
  --dsw-static-neutral-00: #fbfaf6;
  --dsw-static-neutral-50: #f7f5ef;
  --dsw-static-neutral-100: #efede5;
  --dsw-static-neutral-150: #eae6dc;
  --dsw-static-neutral-200: #e6e3d9;
  --dsw-static-neutral-250: #dcd8cd;
  --dsw-static-neutral-300: #d3cec2;
  --dsw-static-neutral-400: #b3ada1;
  --dsw-static-neutral-500: #8f8a80;
  --dsw-static-neutral-550: #7a8079;
  --dsw-static-neutral-600: #5f655f;
  --dsw-static-neutral-700: #3c423e;
  --dsw-static-neutral-800: #2c312e;
  --dsw-static-neutral-850: #242826;
  --dsw-static-neutral-900: #1b1e1c;
  --dsw-static-neutral-1000: #0f1210;

  /* 电光蓝族 → 黛青/青玉（这是 v4 里最后一批高饱和蓝的来源） */
  --dsw-static-deepseek-50: #eff4f5;
  --dsw-static-deepseek-100: #dfeaec;
  --dsw-static-deepseek-200: #c6dadf;
  --dsw-static-deepseek-300: #a0c2ca;
  --dsw-static-deepseek-400: #6f9da9;
  --dsw-static-deepseek-450: #548697;
  --dsw-static-deepseek-500: #2b6272;
  --dsw-static-deepseek-600: #245260;
  --dsw-static-deepseek-700-delete: #1d434e;
  --dsw-static-deepseek-800: #183540;
  --dsw-static-deepseek-900: #132830;
  --dsw-static-blue-50: #eff4f5;
  --dsw-static-blue-50p: #eaf0f1;
  --dsw-static-blue-75: #e4ecee;
  --dsw-static-blue-100: #dfeaec;
  --dsw-static-blue-300: #a0c2ca;
  --dsw-static-blue-400: #6f9da9;
  --dsw-static-blue-450: #548697;
  --dsw-static-blue-500: #3f7d6a;
  --dsw-static-blue-600: #2b6272;
  --dsw-static-blue-800: #1d434e;
  --dsw-static-blue-900: #183540;
  --dsw-static-blue-950: #132830;

  /* 语义色去饱和（原值是高饱和荧光绿/正红/橙） */
  --dsw-static-green-100: #e4efe8;
  --dsw-static-green-400: #3f7d6a;
  --dsw-static-green-500: #2d7a55;
  --dsw-static-green-500-a08: rgba(45, 122, 85, 0.08);
  --dsw-static-green-500-a12: rgba(45, 122, 85, 0.12);
  --dsw-static-green-900: #1e3a2c;
  --dsw-static-red-50: #f7ece9;
  --dsw-static-red-100: #f0dcd7;
  --dsw-static-red-400: #b9553f;
  --dsw-static-red-400-a12: rgba(166, 61, 46, 0.12);
  --dsw-static-red-500: #a63d2e;
  --dsw-static-red-600: #8f3225;
  --dsw-static-red-600-a08: rgba(166, 61, 46, 0.08);
  --dsw-static-red-900: #3d1511;
  --dsw-static-amber-100: #f6eddd;
  --dsw-static-amber-400: #b07c2e;
  --dsw-static-amber-500: #94661c;
  --dsw-static-amber-600: #855a19;
  --dsw-static-amber-900: #2e2210;
  --dsw-static-violet-400: #7d6c9e;
  --dsw-static-violet-600: #61527d;

  /* ── --dsw-specific-*：另一族专用令牌，同样指向静态色板 ──────────
     侧栏、气泡、菜单、登录输入读的是这族（宿主按主题给它不同指针：
     浅色 sidebar-fill → bluish-50，深色 → bluish-900）。我们把指针本身
     落到玉色阶梯，这样深浅两侧都跟着走，不用逐主题再翻一次。 */
  --dsw-specific-sidebar-fill: #f4f2ec;
  --dsw-specific-sidebar-nav-item-active: #efede5;
  --dsw-specific-sidebar-nav-item-active-accent: #e6e3d9;
  --dsw-specific-bubble: #fbfaf6;
  --dsw-specific-bubble-highlight: #efede5;
  --dsw-specific-menu: #fbfaf6;
  --dsw-specific-selector: #efede5;
  --dsw-specific-input-major: #e6e3d9;
  --dsw-specific-login-input: #fbfaf6;
  --dsw-specific-tip: #efede5;
  /* rc.5 新增：上传轨道、引导头图、侧栏右缘闪光、毛玻璃三态、侧栏色调
     与上下洗色（wash-top/bottom 及各自的透明收口）。玻璃面用宣纸白半透明，
     洗色用黛青低透明——侧栏在深浅两侧都必须比页面底更沉。 */
  --dsw-specific-file-upload-track: rgba(38, 42, 36, 0.08);
  --dsw-specific-guide-hero: #dcd8cd;
  --dsw-specific-sidebar-right-flash: #2b6272;
  --dsw-specific-sidebar-glass-fill: rgba(251, 250, 246, 0.55);
  --dsw-specific-sidebar-glass-hover: rgba(251, 250, 246, 0.3);
  --dsw-specific-sidebar-glass-collapsed-fill: transparent;
  --dsw-specific-sidebar-glass-collapsed-hover: rgba(38, 42, 36, 0.05);
  --dsw-specific-sidebar-tint: color-mix(in oklab, #2b6272 6%, transparent);
  --dsw-specific-sidebar-wash-top: rgba(43, 98, 114, 0.08);
  --dsw-specific-sidebar-wash-top-clear: rgba(43, 98, 114, 0);
  --dsw-specific-sidebar-wash-bottom: rgba(43, 98, 114, 0.07);
  --dsw-specific-sidebar-wash-bottom-clear: rgba(43, 98, 114, 0);

}

/* 品牌层映射：插件面读 --et-*；别名从 body 继承，独立挂载时退回浅色兜底。
   注意选择器只做映射、不重定义 --dsw-alias-*——否则元素自持浅色别名，深色失效。 */
body, [data-eterna-ui] {
  --et-bg: var(--dsw-alias-bg-base, #f4f2ec);
  --et-surface: var(--dsw-alias-bg-layer-1, #fbfaf6);
  --et-surface-2: var(--dsw-alias-bg-layer-2, #efede5);
  --et-surface-3: var(--dsw-alias-bg-layer-3, #e6e3d9);
  --et-fg: var(--dsw-alias-label-primary, #1b1e1c);
  --et-fg-2: var(--dsw-alias-label-secondary, #3c423e);
  --et-muted: var(--dsw-alias-label-tertiary, #5f655f);
  --et-meta: var(--dsw-alias-label-dimmed, #6f756e);
  --et-border: var(--dsw-alias-border-l2, #dcd8cd);
  --et-border-soft: var(--dsw-alias-border-l1, #eae6dc);
  --et-accent: var(--dsw-alias-state-business-primary, #2b6272);
  --et-accent-hover: color-mix(in oklab, var(--et-accent), black 14%);
  --et-accent-active: color-mix(in oklab, var(--et-accent), black 24%);
  /* 宿主的 business-primary 是浅色强调字色，直接当白字按钮底对比度不足；
     混黑 38% 后白字约 5.4:1。深色主题下 accent 本身已够浅，走独立兜底。 */
  --et-accent-fill: var(--dsw-alias-button-primary-fill, #2b6272);
  --et-accent-fill-hover: var(--dsw-alias-button-primary-hover, #224f5c);
  --et-accent-on: #fbfaf6;
  --et-accent-soft: color-mix(in oklab, var(--et-accent), transparent 90%);
  --et-success: var(--dsw-alias-state-success-primary, #2d7a55);
  --et-warn: var(--dsw-alias-state-warn-primary, #94661c);
  --et-danger: var(--dsw-alias-state-error-primary, #a63d2e);
  --et-danger-soft: color-mix(in oklab, var(--et-danger), transparent 90%);
  --et-jade: var(--dsw-alias-state-done-primary, #3f7d6a);
  --et-sand: #c2a179;
  --et-bevel: inset 0 1px 0 color-mix(in oklab, #fff, transparent 30%);
  --et-focus-ring: 0 0 0 3px color-mix(in oklab, var(--et-accent), transparent 74%);
  --et-selection: color-mix(in oklab, var(--et-accent), transparent 78%);
  --et-scrim: var(--dsw-alias-bg-mask-1, rgba(22, 25, 23, 0.42));
  --et-overlay: var(--dsw-alias-bg-mask-1, rgba(22, 25, 23, 0.42));
  /* v4 阴影阶梯:组件(卡面/浮层)按 r1..r4 取值,桥接模式此前整档缺失——
   * 组件引用解析为空,应用内卡面与下拉弹层无阴影。宿主 ui-theme 只提供
   * lv1..lv3,第四档以 lv3 收口;深浅主题由宿主 lv 值自带切换。 */
  --et-shadow-r1: var(--dsw-shadow-lv1, 0 1px 2px rgba(38, 42, 36, 0.05), 0 2px 6px rgba(38, 42, 36, 0.04));
  --et-shadow-r2: var(--dsw-shadow-lv2, 0 1px 2px rgba(38, 42, 36, 0.05), 0 8px 24px rgba(38, 42, 36, 0.07));
  --et-shadow-r3: var(--dsw-shadow-lv3, 0 2px 6px rgba(38, 42, 36, 0.07), 0 16px 40px rgba(38, 42, 36, 0.1));
  --et-shadow-r4: var(--dsw-shadow-lv3, 0 4px 12px rgba(38, 42, 36, 0.09), 0 24px 64px rgba(38, 42, 36, 0.18));
  /* v3 兼容别名(v4 tokens.ts 同口径:指向 r2)。 */
  --et-shadow: var(--et-shadow-r2);
  --et-shadow-raised: var(--et-shadow-r2);
}

/* 深色：只换中性别名（同一批名字，主题由壳切换 data-ds-dark-theme）。
   同样用 html body 前缀：宿主的深色块也是 body[...]，避免被后注入者冲掉。 */
html body[data-ds-dark-theme] {
  --dsw-alias-bg-base: #161917;
  --dsw-alias-bg-layer-1: #1d211f;
  --dsw-alias-bg-layer-2: #242826;
  --dsw-alias-bg-layer-3: #2c312e;
  --dsw-alias-bg-layer-4: #2c312e;
  --dsw-alias-bg-module-platform: #242826;
  --dsw-alias-bg-skeleton: rgba(255, 255, 255, 0.06);
  --dsw-alias-bg-mask-1: rgba(8, 10, 9, 0.62);
  --dsw-alias-border-l1: #272b29;
  --dsw-alias-border-l2: #333835;
  --dsw-alias-border-l3: #333835;
  --dsw-alias-border-l4: #3d433f;
  --dsw-alias-label-primary: #eceee9;
  --dsw-alias-label-secondary: #c4c9c2;
  --dsw-alias-label-tertiary: #9aa096;
  --dsw-alias-label-dimmed: #8b9188;
  --dsw-alias-label-caption: #8b9188;
  --dsw-alias-label-primary-foreground: #1b1e1c;
  --dsw-alias-label-primary-inverted: #1d211f;
  --dsw-alias-menu-icon: #c4c9c2;
  --dsw-alias-menu-group-header-fill: #1d211f;
  --dsw-alias-button-elevated-fill: #242826;
  --dsw-alias-button-floating-fill: #242826;
  --dsw-alias-button-floating-hover: #2c312e;
  --dsw-alias-button-ghost-active-fill: #2c312e;
  --dsw-alias-button-ghost-active-hover: #333835;
  --dsw-alias-button-ghost-active-border: #3d433f;
  --dsw-alias-button-primary-dimmed: #2c312e;
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.06);
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.1);
  --dsw-alias-interactive-bg-hover-solid: #2c312e;
  --dsw-alias-scrollbar-bg-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-scrollbar-hover-l2: rgba(255, 255, 255, 0.24);
  --dsw-alias-markdown-code-block: #1d211f;
  --dsw-alias-markdown-code-block-banner: #242826;
  --dsw-alias-markdown-inline-code: #2c312e;
  --dsw-alias-markdown-tag: #242826;
  --dsw-alias-markdown-citation: #242826;
  --dsw-alias-turn-trigger-bg: #242826;
  --dsw-alias-turn-trigger-bg-hover: #2c312e;
  --dsw-alias-border-l2-darkmode-thin: #272b29;
  --dsw-alias-button-tool-bar-fill: rgba(255, 255, 255, 0.28);
  --dsw-alias-button-tool-bar-hover: rgba(255, 255, 255, 0.4);
  --dsw-alias-switch-thumb: #eceee9;
  --dsw-alias-label-shimmer: rgba(255, 255, 255, 0.16);
  --dsw-alias-code-diff-added: rgba(108, 194, 148, 0.16);
  --dsw-alias-code-diff-deleted: rgba(224, 138, 123, 0.16);

  /* 深色强调用浅黛青做字色，实心按钮底走更暗的 #39727f */
  --dsw-alias-state-business-primary: #7fb2bd;
  --dsw-alias-state-business-tertiary: rgba(127, 178, 189, 0.16);
  --dsw-alias-link: #7fb2bd;
  --dsw-alias-button-primary-fill: #39727f;
  --dsw-alias-button-primary-hover: #43828f;
  --dsw-alias-interactive-bg-hover-accent: rgba(127, 178, 189, 0.18);
  --dsw-alias-label-primary-bluish: #eceee9;

  --dsw-alias-state-success-primary: #6cc294;
  --dsw-alias-state-success-tertiary: rgba(108, 194, 148, 0.16);
  --dsw-alias-state-warn-primary: #dfae62;
  --dsw-alias-state-warn-label: #dfae62;
  --dsw-alias-state-warn-tertiary: rgba(223, 174, 98, 0.16);
  --dsw-alias-state-error-primary: #e08a7b;
  --dsw-alias-interactive-bg-hover-danger: rgba(224, 138, 123, 0.12);
  --dsw-alias-label-error: #e08a7b;
  --dsw-alias-state-idle-primary: #4a514c;
  --dsw-alias-state-done-primary: #5f9b86;

  --dsw-alias-toast-bg: #2c312e;
  --dsw-alias-toast-label: #eceee9;
  --dsw-alias-tooltip-bg: #2c312e;
  --dsw-alias-tooltip-key-bg: #3d433f;

  --dsw-alias-brand-primary: #eceee9;
  --dsw-alias-brand-text: #eceee9;
  --dsw-alias-brand-primary-new-colorprimary-new-color: #7fb2bd;

  /* 补漏别名（深色侧；对应浅色那批，一个都不少） */
  --dsw-alias-button-info-fill: #3f7d6a;
  --dsw-alias-button-info-hover: #4b8d79;
  --dsw-alias-button-contrast-fill: #eceee9;
  --dsw-alias-button-tool-bar-fill-invisible: rgba(255, 255, 255, 0);
  --dsw-alias-bg-overlay: #1d211f;
  --dsw-alias-bg-mask-2: rgba(8, 10, 9, 0.4);
  --dsw-alias-bg-mask-3: rgba(8, 10, 9, 0.72);
  --dsw-alias-bg-mask-drop: rgba(8, 10, 9, 0.56);
  --dsw-alias-bg-mask-photo: rgba(8, 10, 9, 0.8);
  --dsw-alias-bg-multi-select: #2c312e;
  --dsw-alias-bg-document-preview: #242826;
  --dsw-alias-bg-document-selection: rgba(127, 178, 189, 0.24);
  --dsw-alias-border-inverted: rgba(255, 255, 255, 0);
  --dsw-alias-border-inverted2: rgba(255, 255, 255, 0);
  --dsw-alias-brand-primary-invert: #1b1e1c;
  --dsw-alias-label-primary-dimmed: #eceee9;
  --dsw-alias-label-document-preview: #c4c9c2;
  --dsw-alias-label-deep-diving: #9aa096;
  --dsw-alias-label-deep-diving-shimmer: rgba(255, 255, 255, 0.12);
  --dsw-alias-markdown-placeholder: #2c312e;
  --dsw-alias-markdown-code-segment-selected: #333835;
  --dsw-alias-markdown-code-segment-unselected: #242826;
  --dsw-alias-settings-card-fill: #1d211f;
  --dsw-alias-settings-card-stroke: #272b29;
  --dsw-alias-onboarding-accent: #7fb2bd;
  --dsw-alias-onboarding-card-fill: #242826;
  --dsw-alias-onboarding-secondary-fill: #2c312e;
  --dsw-alias-onboarding-checkbox-border: #3d433f;
  --dsw-alias-scrollbar-bg-l1: rgba(255, 255, 255, 0.1);
  --dsw-alias-scrollbar-hover-l1: rgba(255, 255, 255, 0.22);
  --dsw-alias-state-success-secondary: #5f9b86;
  --dsw-alias-state-error-secondary: #e08a7b;
  --dsw-alias-state-warn-secondary: #dfae62;
  --dsw-alias-file-diff-added-bg: rgba(95, 155, 134, 0.14);
  --dsw-alias-file-diff-added-gutter: rgba(95, 155, 134, 0.2);
  --dsw-alias-file-diff-added-marker: #5f9b86;
  --dsw-alias-file-diff-deleted-bg: rgba(224, 138, 123, 0.14);
  --dsw-alias-file-diff-deleted-gutter: rgba(224, 138, 123, 0.2);
  --dsw-alias-file-diff-deleted-marker: #e08a7b;
  --dsw-alias-illustration-background: #242826;
  --dsw-alias-illustration-backing: #2c312e;
  --dsw-alias-illustration-detail: #a98a63;
  --dsw-alias-illustration-inset: #1d211f;
  --dsw-alias-illustration-shadow: rgba(0, 0, 0, 0.24);
  --dsw-alias-illustration-surface: #1d211f;

  /* rc.5 新增别名（深色侧；与浅色那批一一对应） */
  --dsw-alias-tooltip-label: #eceee9;
  --dsw-alias-toast-action: #7fb2bd;
  --dsw-alias-hovercard-bg: #242826;
  --dsw-alias-hovercard-label-primary: #eceee9;
  --dsw-alias-hovercard-label-secondary: #c4c9c2;
  --dsw-alias-hovercard-label-tertiary: #9aa096;
  --dsw-alias-hovercard-state-done: #a99bc4;
  --dsw-alias-hovercard-state-error: #e08a7b;
  --dsw-alias-card-fill: #242826;
  --dsw-alias-card-fill-hover: #2c312e;
  --dsw-alias-card-tile-fill: rgba(236, 238, 233, 0.06);
  --dsw-alias-border-selected: #8b9188;
  --dsw-alias-label-on-color: #fbfaf6;
  --dsw-alias-trajectory-accent: #7fb2bd;
  --dsw-alias-chart-messages: #7fb2bd;
  --dsw-alias-chart-system: #9aa096;
  --dsw-alias-chart-tools: #9d8bbd;
  --dsw-alias-json-tree-property: #9d8bbd;
  --dsw-alias-json-tree-string: #e08a7b;
  --dsw-alias-json-tree-number: #7fb2bd;
  --dsw-alias-json-tree-keyword: #7fb2bd;
  --dsw-alias-json-tree-punctuation: #eceee9;
  --dsw-alias-json-tree-icon: #9aa096;
  --dsw-alias-json-tree-hover: rgba(236, 238, 233, 0.08);

  /* --dsw-specific-* 的深色侧（侧栏/气泡/菜单必须比页面底更沉，不能更亮） */
  --dsw-specific-sidebar-fill: #161917;
  --dsw-specific-sidebar-nav-item-active: #242826;
  --dsw-specific-sidebar-nav-item-active-accent: #2c312e;
  --dsw-specific-bubble: #1d211f;
  --dsw-specific-bubble-highlight: #2c312e;
  --dsw-specific-menu: #1d211f;
  --dsw-specific-selector: #242826;
  --dsw-specific-input-major: #2c312e;
  --dsw-specific-login-input: #1d211f;
  --dsw-specific-tip: #242826;
  --dsw-specific-file-upload-track: rgba(255, 255, 255, 0.08);
  --dsw-specific-guide-hero: #3c423e;
  --dsw-specific-sidebar-right-flash: #eceee9;
  --dsw-specific-sidebar-glass-fill: rgba(255, 255, 255, 0.15);
  --dsw-specific-sidebar-glass-hover: rgba(255, 255, 255, 0.3);
  --dsw-specific-sidebar-glass-collapsed-fill: rgba(255, 255, 255, 0.15);
  --dsw-specific-sidebar-glass-collapsed-hover: rgba(255, 255, 255, 0.08);
  --dsw-specific-sidebar-tint: color-mix(in oklab, #7fb2bd 10%, transparent);
  --dsw-specific-sidebar-wash-top: rgba(127, 178, 189, 0.08);
  --dsw-specific-sidebar-wash-top-clear: rgba(127, 178, 189, 0);
  --dsw-specific-sidebar-wash-bottom: rgba(127, 178, 189, 0.09);
  --dsw-specific-sidebar-wash-bottom-clear: rgba(127, 178, 189, 0);

  /* 品牌层在深色下的本地派生（含柔影与语义软底：SHARED 给的是浅色基准） */
  --et-accent-fill: var(--dsw-alias-button-primary-fill);
  --et-accent-fill-hover: var(--dsw-alias-button-primary-hover);
  --et-accent-on: #f7fbfc;
  --et-jade: #5f9b86;
  --et-sand: #a98a63;
  --et-bevel: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --et-shadow-r1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --et-shadow-r2: 0 2px 6px rgba(0, 0, 0, 0.34), 0 10px 28px rgba(0, 0, 0, 0.24);
  --et-shadow-r3: 0 4px 12px rgba(0, 0, 0, 0.4), 0 18px 44px rgba(0, 0, 0, 0.34);
  --et-shadow-r4: 0 8px 20px rgba(0, 0, 0, 0.46), 0 28px 72px rgba(0, 0, 0, 0.5);
  --et-shadow: 0 2px 6px rgba(0, 0, 0, 0.34), 0 10px 28px rgba(0, 0, 0, 0.24);
  --et-shadow-raised: 0 2px 6px rgba(0, 0, 0, 0.34), 0 10px 28px rgba(0, 0, 0, 0.24);
  --et-warn-soft: rgba(223, 174, 98, 0.16);
  --et-danger-soft: rgba(224, 138, 123, 0.14);
  --et-accent-soft: rgba(127, 178, 189, 0.16);
}
`

const STYLE_ID = 'eterna-ui-tokens'

/**
 * 幂等注入设计令牌。应用内传 bridge=true 以跟随 DSH 主题；独立页保持默认
 * 品牌浅色 + 系统深色。
 * @returns 移除注入节点的 disposer（插件卸载零残留）。
 */
export function injectDesignTokens(options: { readonly bridge?: boolean; readonly doc?: Document } = {}): () => void {
  const doc = options.doc ?? document
  // 应用内只注入非颜色令牌 + 宿主桥接 + 共享基础件：不设置 color-scheme，避免覆盖
  // 产品壳自身的主题选择；独立页才使用完整品牌浅/深色令牌。
  // 基础件样式只在应用内下发（class 契约限定 [data-eterna-ui] 作用域）。
  const css = options.bridge === true
    ? `:root {${SHARED}}\n${DSH_BRIDGE_CSS}\n${COMPONENT_CSS}`
    : WEBFLOW_TOKENS_CSS
  const existing = doc.querySelector(`#${STYLE_ID}`)
  if (existing !== null) {
    if (existing.textContent !== css) existing.textContent = css
    return () => { existing.remove() }
  }
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  doc.head.append(style)
  // v4 作用域标识：COMPONENT_CSS 的 `.et-*` 契约全部限定在 [data-eterna-ui]，
  // 但应用内没有任何组件去设置该属性——不在此处落一次，共享基础件（含玉环、
  // 决策卡、按钮）在生产环境一条都不生效（实测 r1 玉环渲染成 SVG 默认黑盘）。
  // 落在 body 而不是某个插件面：一个插件注入过，全产品面共用同一套基础件。
  // body 在类型上非空，但 vm 冒烟桩只提供 head——运行时必须容忍。
  // 没有 body 就没有挂载点，组件面本来也不会渲染，标记留待下一次注入。
  const body = doc.body as HTMLElement | null | undefined
  if (options.bridge === true && body != null) body.setAttribute('data-eterna-ui', '')
  return () => {
    style.remove()
    if (options.bridge === true && body != null) body.removeAttribute('data-eterna-ui')
  }
}
