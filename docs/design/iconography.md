# 图标规范（iconography v1）

> 2026-11-11 起为仓库强制规范。目标：把界面图标、插件卡片图标与品牌标收进同一套
> 可复用的「恒环·节点」语言，后续插件不再各自手写 SVG 或混用上游图标。
>
> 参考实现：`packages/ui/src/icon-data.ts`、`packages/ui/src/icons.tsx`、
> `packages/access/src/client/plugin-art.ts`。视觉样张：项目 `icons.html`。

## 1. 语言

- **恒环**：容器、边界、状态由圆角闭合线条表达；线端圆头，转角圆角。
- **节点**：每张图标最多一个实心节点（圆点或焦点块），只在需要强调
  「连接 / 事件 / 当前对象」时出现；不滥用为装饰。
- **留白**：24 网格中保留 2px 四周留白（20px 视觉区）；36 网格保留 4px。
- **不填充**：界面图标一律描边、`currentColor`；不使用渐变、阴影或双色。

## 2. 界面图标

| 项目 | 规范 |
| --- | --- |
| 网格 | 24 × 24；视觉区 20 × 20 |
| 描边 | 1.75；圆头 `round`；圆角连接 `round` |
| 尺寸 | 14（目录树）/ 16（行内、侧栏）/ 18（输入内按钮）/ 20（导航、按钮）/ 24（空态、营销位） |
| 颜色 | `currentColor`，跟随文字/图标容器；选中/焦点由外层状态色负责 |
| 最小尺寸 | 14；低于 14 改用文字或更大的容器 |
| 可访问性 | 装饰性图标 `aria-hidden`；独立图标按钮必须有 `aria-label` |

### 2.1 交付面

- React：`import { Icon } from '@eterna/ui/icons'`，`<Icon name="folder" size={16} />`。
- 服务端/独立页字符串：`import { iconSvg } from '@eterna/ui/icon-data'`，
  `iconSvg('eye', 18, 'ic-eye')`。
- 品牌标：`brandMarkSvg(size)`（纯闪电）；品牌标不进入界面图标集合，
  全产品只保留这一枚。

### 2.2 现有集合

`gauge` 基座面板 · `chart` 用量统计 · `prompt` 提示词工坊 · `trace` 循环轨迹 ·
`folder` 目录 · `chevron-right/down` 展开收起 · `eye/eye-off` 密码可见性 ·
`search` 搜索 · `plus` 新建 · `check` 成功 · `close` 关闭 · `copy` 复制 ·
`trash` 删除 · `arrow-right` 前进/打开。

## 3. 插件卡片图标

插件页 48px 容器内使用 36px 图标：

- 36 网格、4px 留白、2.25 描边、圆头圆角。
- **双色**：前景线条 `currentColor`；焦点元素 `var(--et-accent)` /
  `var(--et-accent-soft)`。深浅主题自动适配。
- 禁止渐变、上游插画色、字面 hex；新增插件图标只能扩展
  `packages/access/src/client/plugin-art.ts`。
- 语义优先：治理=盾+勾、审计=文档+印章、出网=地球+外向箭头、门禁=锁、
  记忆=分层、知识=书+书签、诊断=脉搏+节点、品牌=环+闪电、面板=四格、
  提示词=列表+笔。

## 4. 品牌标

- 闪电路径：`M13 2L4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2Z`（24 网格）；
  `packages/brand/src/client/index.ts` 与 `brandMarkSvg` 共用 `@eterna/ui/icon-data` 的同一常量。
- UI 内使用 `currentColor`，由容器着色（侧栏/登录页为强调蓝）。
- 应用图标：`packages/brand/assets/icon.svg`，Webflow Blue 底 + 28% 白恒环 +
  白闪电；16px 场景使用纯闪电 favicon，32px 以上使用完整标。
- 最小尺寸：完整标 32；纯闪电 14。四周留白不小于 2（24 网格）。
- 不旋转、不拉伸、不换色为非品牌色、不在闪电上叠加文字。

## 5. 禁止

- 用 emoji 作为功能图标（`▾`、`▸`、`✓` 等文字符号也不再作为图标）。
- 在组件里一次性手写 `<svg>`；新增图标必须进共享集合。
- 混用上游 `ui-primitives` 图标、第三方图标库与自绘图标。
- 给每个标题配图标、用图标替代文字标签、用颜色/图标单独表达状态。
- 在图标内写死 hex、渐变或阴影。

## 6. 新增图标流程

1. 先确认现有集合没有可复用的语义；不要为同一动作造第二个图标。
2. 在 `packages/ui/src/icon-data.ts` 的 `ICON_NAMES` 与 `ICONS` 中加入
   24 网格路径；保持 2px 留白、1.75 描边、圆头圆角。
3. React 侧自动可用：`<Icon name="…" />`；服务端侧用 `iconSvg('…')`。
4. 在 `icons.html` 样张与本文 §2.2 列表中登记。
5. 运行 `node scripts/lint-ui-tokens.mjs` 与受影响包的类型检查/测试；图标不得引入字面 hex。

## 7. 替换记录（v1）

| 原实现 | 新实现 |
| --- | --- |
| `IconGaugeOutlineRegular`（基座面板） | `Icon name="gauge"` |
| `IconDataOutlineRegular`（用量统计） | `Icon name="chart"` |
| `IconListPenOutlineRegular`（提示词工坊） | `Icon name="prompt"` |
| `IconWorkspaceTreeOutlineRegular`（循环轨迹） | `Icon name="trace"` |
| 目录树文字箭头 `▾/▸` | `chevron-down / chevron-right` |
| 目录树内联文件夹 SVG | `folder` |
| 设置/登录页手写眼睛 SVG | `eye / eye-off` |
| 10 张渐变插件插画 | `plugin-art.ts` 36px 双色线稿 |
| 512 渐变品牌资产 | 24 网格闪电 + Webflow Blue 应用图标 |
