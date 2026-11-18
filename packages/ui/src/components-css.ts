/**
 * v4 共享基础件样式（class 契约）。
 *
 * 各插件不再各写一份按钮/输入/卡片，统一用这里的 `.et-*` class；
 * 组件（`./components.tsx`）只是同一套 class 的 React 包装。
 *
 * 规则来源：docs/design/frontend-style.md §6、42 号 §3/§4/§5。
 * - 全部取 `--et-*` 令牌，禁止字面色值/字号/圆角/阴影
 * - 圆角只用阶梯值，且满足同心弧（子 = 父 − 内距）
 * - 正文 400，强调 500，标题 600；字重不出现 500 以外的"半档"
 * - 动效只碰 transform/opacity/color/box-shadow，并覆盖 reduced-motion
 *
 * 作用域：`[data-eterna-ui]` 之内（应用内插件面）。独立页直接用同名 class
 * 亦可，但独立页由 pages.ts 自带令牌块，不依赖本文件。
 */
export const COMPONENT_CSS = `
/* ── 按钮 ─────────────────────────────────────────────────────────
   高 40 / radius-md(16) / 15px / 400→600 随层级
   主操作实心：accent-fill 底 + accent-on 字（白字对比 ≥4.5:1）
   次要：透明底 + border；幽灵：无边框 muted；破坏：danger 描边 30%+danger 字 */
[data-eterna-ui] .et-btn {
  --et-btn-h: 40px;
  display: inline-flex; align-items: center; justify-content: center; gap: var(--et-space-2);
  height: var(--et-btn-h); min-width: 0; margin: 0; padding: 0 var(--et-space-4);
  border: 1px solid transparent; border-radius: var(--et-radius-md);
  background: transparent; color: var(--et-fg);
  font-family: var(--et-font-body); font-size: var(--et-text-body); font-weight: var(--et-weight-emphasis);
  line-height: 1; white-space: nowrap; text-decoration: none; cursor: pointer;
  transition: background-color var(--et-motion-fast) var(--et-ease),
              border-color var(--et-motion-fast) var(--et-ease),
              color var(--et-motion-fast) var(--et-ease),
              box-shadow var(--et-motion-fast) var(--et-ease),
              transform var(--et-motion-fast) var(--et-ease);
}
[data-eterna-ui] .et-btn:focus-visible { outline: none; box-shadow: var(--et-focus-ring); }
[data-eterna-ui] .et-btn:active:not(:disabled) { transform: scale(0.985); }
[data-eterna-ui] .et-btn:disabled, [data-eterna-ui] .et-btn[aria-disabled='true'] {
  opacity: 0.5; cursor: not-allowed; transform: none;
}

/* 主操作：每屏 ≤2 处可见（与选中/焦点共享预算） */
[data-eterna-ui] .et-btn--primary {
  background: var(--et-accent-fill); color: var(--et-accent-on); border-color: transparent;
  box-shadow: var(--et-shadow-r1);
}
[data-eterna-ui] .et-btn--primary:hover:not(:disabled) { background: var(--et-accent-fill-hover); }

/* 次要：1px 结构边框，与卡片同族 */
[data-eterna-ui] .et-btn--secondary {
  background: var(--et-surface); border-color: var(--et-border); color: var(--et-fg);
}
[data-eterna-ui] .et-btn--secondary:hover:not(:disabled) { background: var(--et-surface-2); border-color: var(--et-border); }

/* 幽灵：出现在行内/工具条，不抢任何强调预算 */
[data-eterna-ui] .et-btn--ghost { color: var(--et-muted); padding: 0 var(--et-space-3); }
[data-eterna-ui] .et-btn--ghost:hover:not(:disabled) { background: var(--et-surface-2); color: var(--et-fg); }

/* 破坏：不填红底，只在危险语义下用 30% 描边 + danger 字（两击确认由调用方保证） */
[data-eterna-ui] .et-btn--danger {
  background: transparent; border-color: color-mix(in oklab, var(--et-danger), transparent 70%);
  color: var(--et-danger);
}
[data-eterna-ui] .et-btn--danger:hover:not(:disabled) {
  background: var(--et-danger-soft); border-color: color-mix(in oklab, var(--et-danger), transparent 45%);
}
/* 已确认态：唯一允许的实心语义底（danger 底 + 白字） */
[data-eterna-ui] .et-btn--danger[data-armed='true'] {
  background: var(--et-danger); border-color: var(--et-danger); color: var(--et-accent-on);
}

[data-eterna-ui] .et-btn--sm { --et-btn-h: 32px; padding: 0 var(--et-space-3); font-size: var(--et-text-caption); border-radius: var(--et-radius-sm); }
[data-eterna-ui] .et-btn--lg { --et-btn-h: 48px; padding: 0 var(--et-space-5); font-size: var(--et-text-lead); }
[data-eterna-ui] .et-btn--block { width: 100%; }
[data-eterna-ui] .et-btn--icon { width: var(--et-btn-h); padding: 0; }

/* ── 输入 ─────────────────────────────────────────────────────────
   surface-3 底(凹槽) / sm(12) / 高 40 / 聚焦边框转 accent + 3px 光环 */
[data-eterna-ui] .et-input, [data-eterna-ui] .et-textarea, [data-eterna-ui] .et-select {
  display: block; width: 100%; min-width: 0; margin: 0;
  padding: 0 var(--et-space-3); height: 40px;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  background: var(--et-surface-3); color: var(--et-fg);
  font-family: var(--et-font-body); font-size: var(--et-text-body); font-weight: var(--et-weight-body);
  line-height: normal;
  transition: border-color var(--et-motion-fast) var(--et-ease), box-shadow var(--et-motion-fast) var(--et-ease);
}
[data-eterna-ui] .et-textarea {
  height: auto; min-height: 88px; padding: var(--et-space-3);
  line-height: var(--et-leading-body); resize: vertical;
}
[data-eterna-ui] .et-select { padding-right: var(--et-space-2); cursor: pointer; }

[data-eterna-ui] .et-input::placeholder, [data-eterna-ui] .et-textarea::placeholder { color: var(--et-meta); opacity: 1; }
[data-eterna-ui] .et-input:focus, [data-eterna-ui] .et-textarea:focus, [data-eterna-ui] .et-select:focus {
  outline: none; border-color: var(--et-accent); box-shadow: var(--et-focus-ring);
}
[data-eterna-ui] .et-input:disabled, [data-eterna-ui] .et-textarea:disabled, [data-eterna-ui] .et-select:disabled {
  opacity: 0.55; cursor: not-allowed;
}
/* 校验失败：只染边框与提示文字，不染整片底 */
[data-eterna-ui] .et-input[aria-invalid='true'], [data-eterna-ui] .et-textarea[aria-invalid='true'] {
  border-color: var(--et-danger);
}
[data-eterna-ui] .et-field-msg { margin: var(--et-space-2) 0 0; font-size: var(--et-text-caption); color: var(--et-meta); }
[data-eterna-ui] .et-field-msg[data-tone='error'] { color: var(--et-danger); }

/* ── 卡片 ─────────────────────────────────────────────────────────
   一级：surface + border-soft + r1 + lg(22) + 内距 20
   强调：+ bevel + r2（每屏 ≤1）
   凹槽：surface-2、无边框无阴影、md(16)——用于卡内分组，不算"卡片套卡片" */
[data-eterna-ui] .et-card {
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-lg);
  background: var(--et-surface); box-shadow: var(--et-shadow-r1);
  padding: var(--et-space-5);
}
[data-eterna-ui] .et-card--emphasis { box-shadow: var(--et-bevel), var(--et-shadow-r2); }
[data-eterna-ui] .et-card--inset { border: 0; border-radius: var(--et-radius-md); background: var(--et-surface-2); box-shadow: none; padding: var(--et-space-4); }
[data-eterna-ui] .et-card-title {
  margin: 0 0 var(--et-space-2); font-family: var(--et-font-body); font-size: var(--et-text-lead);
  font-weight: var(--et-weight-display); line-height: var(--et-leading-snug); color: var(--et-fg);
}
[data-eterna-ui] .et-card-desc {
  margin: 0; font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-muted);
  /* 文字预算：说明 ≤40 字；超出由调用方转译，这里只做视觉截断兜底 */
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
[data-eterna-ui] .et-card-actions { display: flex; flex-wrap: wrap; gap: var(--et-space-2); margin-top: var(--et-space-4); }

/* 行卡：高 ≥56，悬停升一级阴影（不是升两级，避免同屏三级） */
[data-eterna-ui] .et-row {
  display: flex; align-items: center; gap: var(--et-space-3); min-height: 56px;
  padding: var(--et-space-3) var(--et-space-4);
  border-radius: var(--et-radius-md); background: var(--et-surface);
  border: 1px solid var(--et-border-soft);
  transition: box-shadow var(--et-motion-base) var(--et-ease), transform var(--et-motion-base) var(--et-ease), background-color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-ui] .et-row:hover { box-shadow: var(--et-shadow-r2); transform: translateY(-2px); }

/* ── 徽标 ─────────────────────────────────────────────────────────
   pill / 高 28 / 内距 6×12 / 11–12px；状态色必须配文字（调用方保证） */
[data-eterna-ui] .et-badge {
  display: inline-flex; align-items: center; gap: 6px; height: 28px;
  padding: 0 var(--et-space-3); border-radius: var(--et-radius-pill);
  background: var(--et-surface-2); color: var(--et-muted);
  font-size: var(--et-text-meta); font-weight: var(--et-weight-emphasis); line-height: 1; white-space: nowrap;
}
[data-eterna-ui] .et-badge[data-tone='accent'] { background: var(--et-accent-soft); color: var(--et-accent); }
[data-eterna-ui] .et-badge[data-tone='success'] { background: color-mix(in oklab, var(--et-success), transparent 88%); color: var(--et-success); }
[data-eterna-ui] .et-badge[data-tone='warn'] { background: var(--et-warn-soft); color: var(--et-warn); }
[data-eterna-ui] .et-badge[data-tone='danger'] { background: var(--et-danger-soft); color: var(--et-danger); }
[data-eterna-ui] .et-badge[data-tone='jade'] { background: color-mix(in oklab, var(--et-jade), transparent 88%); color: var(--et-jade); }

/* ── 状态珠（式五：色 + 形 + 字，至少两者） ──────────────────── */
[data-eterna-ui] .et-dot {
  --et-dot-size: 10px;
  display: inline-block; width: var(--et-dot-size); height: var(--et-dot-size); flex: none;
  border-radius: var(--et-radius-pill); background: var(--et-border); box-shadow: inset 0 0 0 1.5px var(--et-border);
}
[data-eterna-ui] .et-dot[data-state='running'] { background: var(--et-accent); animation: et-breathe 1.6s var(--et-ease) infinite; }
[data-eterna-ui] .et-dot[data-state='waiting'] { background: var(--et-warn); box-shadow: 0 0 0 3px var(--et-warn-soft); }
[data-eterna-ui] .et-dot[data-state='failed'] { background: var(--et-danger); }
[data-eterna-ui] .et-dot[data-state='done'] { background: var(--et-jade); }
[data-eterna-ui] .et-dot[data-state='idle'] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--et-border); }

@keyframes et-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.92); }
}

/* ── 珠链（式二：过程 → 珠链） ─────────────────────────────── */
[data-eterna-ui] .et-beads { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; list-style: none; }
[data-eterna-ui] .et-bead {
  position: relative; display: flex; align-items: center; gap: var(--et-space-3);
  min-height: 32px; padding-left: var(--et-space-6);
}
/* 2px 连线：从第一颗珠连到最后一颗，不越过首尾 */
[data-eterna-ui] .et-bead::before {
  content: ''; position: absolute; left: 5px; top: 0; bottom: 0; width: 2px;
  background: var(--et-border-soft);
}
[data-eterna-ui] .et-bead:first-child::before { top: 50%; }
[data-eterna-ui] .et-bead:last-child::before { bottom: 50%; }
[data-eterna-ui] .et-bead:only-child::before { display: none; }
[data-eterna-ui] .et-bead > .et-dot { position: absolute; left: 1px; top: 50%; margin-top: -5px; }
[data-eterna-ui] .et-bead-label { font-size: var(--et-text-caption); color: var(--et-fg-2); }
[data-eterna-ui] .et-bead-value {
  margin-left: auto; font-size: var(--et-text-meta); color: var(--et-meta);
  font-variant-numeric: tabular-nums;
}

/* ── 玉环（式三：比例 → 玉环） ─────────────────────────────── */
[data-eterna-ui] .et-ring { position: relative; display: inline-grid; place-items: center; flex: none; }
[data-eterna-ui] .et-ring svg { display: block; transform: rotate(-90deg); overflow: visible; }
[data-eterna-ui] .et-ring-track { fill: none; stroke: var(--et-surface-3); }
[data-eterna-ui] .et-ring-arc {
  fill: none; stroke: var(--et-accent); stroke-linecap: round;
  transition: stroke-dashoffset var(--et-motion-enter) var(--et-ease), stroke var(--et-motion-base) var(--et-ease);
}
[data-eterna-ui] .et-ring-arc[data-tone='success'] { stroke: var(--et-success); }
[data-eterna-ui] .et-ring-arc[data-tone='warn'] { stroke: var(--et-warn); }
[data-eterna-ui] .et-ring-arc[data-tone='danger'] { stroke: var(--et-danger); }
[data-eterna-ui] .et-ring-arc[data-tone='jade'] { stroke: var(--et-jade); }
[data-eterna-ui] .et-ring-value {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg);
  font-variant-numeric: tabular-nums;
}

/* ── 条带（式四：趋势 → 条带） ─────────────────────────────── */
[data-eterna-ui] .et-strip { display: flex; align-items: flex-end; gap: 2px; height: 32px; }
[data-eterna-ui] .et-strip-bar {
  flex: 1 1 0; min-width: 2px; min-height: 2px; border-radius: var(--et-radius-pill);
  background: color-mix(in oklab, var(--et-accent), transparent 62%);
}
[data-eterna-ui] .et-strip-bar[data-peak='true'] { background: var(--et-accent); }
[data-eterna-ui] .et-strip-bar[data-tone='jade'] { background: color-mix(in oklab, var(--et-jade), transparent 62%); }
[data-eterna-ui] .et-strip-bar[data-tone='jade'][data-peak='true'] { background: var(--et-jade); }
[data-eterna-ui] .et-strip-bar[data-tone='sand'] { background: color-mix(in oklab, var(--et-sand), transparent 62%); }
[data-eterna-ui] .et-strip-bar[data-tone='sand'][data-peak='true'] { background: var(--et-sand); }

/* ── 决策层（贴输入卡顶边向上浮出，§7a.2） ────────────────────
   容器不吃点击，只有卡片吃；z-index 200 低于宿主 toast(1100) */
/* 决策层必须挂载在宿主 composer 的零高度锚点(.overlayAnchor)内：
   该锚点已是 position:absolute;inset:0 0 auto，父级 composer 为 relative。
   本类只负责「从锚点向上生长」，不负责定位父级——自带 relative 会让决策卡
   落在文档流任意位置并压住正文。
   锚点高 0，故 bottom:0 即锚点顶边；向上生长靠"内容高于锚点"。 */
[data-eterna-ui] .et-decision-layer {
  position: absolute; inset-inline: 0; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; align-items: center; gap: var(--et-space-2);
  z-index: 200; pointer-events: none;
}
[data-eterna-ui] .et-decision-card {
  position: relative; overflow: hidden; pointer-events: auto;
  width: min(760px, 100%);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-lg);
  background: var(--et-surface); box-shadow: var(--et-shadow-r3);
  padding: var(--et-space-5);
}
/* 倒计时：贴卡片顶边的 2px 条，不是独立一行（否则卡内出现一条横线切断内容） */
[data-eterna-ui] .et-decision-track { position: absolute; inset-block-start: 0; inset-inline: 0; height: 2px; background: var(--et-surface-3); }
[data-eterna-ui] .et-decision-track > i {
  display: block; height: 100%; min-width: 0; background: var(--et-warn);
  transition: width 1s linear; border-radius: var(--et-radius-pill);
}
[data-eterna-ui] .et-decision-card[data-kind='question'] .et-decision-track > i { background: var(--et-accent); }
/* 语义色只用边框/图标，不用整片底色 */
[data-eterna-ui] .et-decision-card[data-kind='approval'] { border-color: color-mix(in oklab, var(--et-warn), transparent 62%); }
[data-eterna-ui] .et-decision-card[data-kind='question'] { border-color: color-mix(in oklab, var(--et-accent), transparent 62%); }

/* 队列：宽屏最多 2 张，其余折叠为「另有 N 项」 */
[data-eterna-ui] .et-decision-more {
  pointer-events: auto; display: inline-flex; align-items: center; gap: var(--et-space-2);
  height: 32px; padding: 0 var(--et-space-3); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-pill); background: var(--et-surface); box-shadow: var(--et-shadow-r1);
  color: var(--et-muted); font-size: var(--et-text-meta); cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  [data-eterna-ui] .et-btn, [data-eterna-ui] .et-row, [data-eterna-ui] .et-ring-arc {
    transition-duration: 120ms !important;
  }
  [data-eterna-ui] .et-btn:active:not(:disabled), [data-eterna-ui] .et-row:hover { transform: none; }
  [data-eterna-ui] .et-dot[data-state='running'] { animation: none; }
}
`
