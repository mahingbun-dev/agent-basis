# 知识库插件 v4 验收截图

真实浏览器（agent-browser / CfT Chromium）对**隔离容器里的实际产品**截图，不是探针页：
`eterna-agent:0.1.43`（生产同构，独立卷 + 独立端口，不动生产）。

深色条件：宿主真实的 `body[data-ds-dark-theme]`（上游没有 `prefers-color-scheme`）。

## 矩阵

| 视口 | 浅色 | 深色 |
| --- | --- | --- |
| 1440 | `kb-light-1440.png` | `kb-dark-1440.png` |
| 900 | `kb-light-900.png` | `kb-dark-900.png` |
| 390 | `kb-light-390.png` | `kb-dark-390.png` |

## 本轮修的三处缺陷（生产 0.1.41 实测）

1. **`data-kb='bar'` 是唯一「用了但没有样式」的标记**，Toolbar 因此退化成块级堆叠：
   1440 下「新建文档」按钮与 `0 条 · 待审提案 0` 挤成一串；390 下每个按钮各占
   一整行、页头「刷新」被 stretch 拉成整宽。→ 补 flex 一行布局 + `wrap`。
2. **按钮 `height:32px`**，不满足 v4「触控 ≥36px」，也与共享 `.et-btn`(40px) 不一致。
   → 40px / md 圆角 / `space-4` 内距，与共享基础件同规格。
3. **输入 `height:36px`** → 40px，圆角 sm→md，字号 caption→body，与 `.et-input` 对齐。

窄视口策略同时调整：
- 640 以下不再「所有按钮一刀切整宽」（会把工具条撑成四行按钮堆）；
  改为工具条内**多个按钮**等分宽度、元数据独占一行；**单个按钮**保持自身宽度
  （`:not(:only-of-type)`）。
- 760 以下页头竖排时按钮保自身宽度靠左（`align-items:flex-start`），不再被拉满。

## 逐项自查（`docs/design/frontend-style.md` §7）

- 令牌：全部 `--et-*`；CSS 内 0 处字面色值（护栏断言，反向测试已验证）。
- 圆角：卡片 22(lg) / 按钮·输入 16(md) / tab 与徽标 pill；嵌套同心弧。
- 字重：只用 400/500/600；正文无 500。
- 字号：正文 15 / 说明 13 / 元数据 12 / 标注 11。
- 强调色每屏 ≤2 处：当前页为「文档」活动 tab + 主按钮。
- 触控：按钮与输入 40px（≥36 达标）。
- 断点只出现 760 / 640（v4 允许集合）；无 900 断点。
- 三视口无横向溢出（`scrollWidth ≤ clientWidth`，390 实测 390/390）。
- `prefers-reduced-motion`：(a) 关闭按钮 `transform`，过渡降到 120ms。
- 深色：所有容器自带 `--et-fg` 文字基线，无继承浏览器默认黑。

## 护栏

`tests/render-smoke.cjs` 新增 3 条断言（离线渲染烟测，无需浏览器）：

- **标记 ↔ 样式覆盖**：渲染出的每个 `data-kb` 标记都必须有「以它为主语」的规则块；
  后代选择器不算。反向测试：把渲染标记改名即报 `unstyled: toolbar` 并 exit 1。
- **触控高度**：`[data-kb=btn]` / `[data-kb=input]` ≥36px。
- **无字面色值**：CSS 里不得出现 `#hex` / `rgb(` / `rgba(`。
