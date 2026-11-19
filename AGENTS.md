# AGENTS.md — EternaAgent 仓库开发规则

> 本文件对所有在本仓库工作的 AI 助手与人类开发者生效。违反 = 审查打回。

## 前端与产品形态铁律（2026-11-10 起，用户强制要求；2026-11-19 升 v4）

**产品内功能一律做成 dsh 原生扩展点插件，禁止自建独立页面入口**（登录门禁页 /login 是唯一例外）：

1. **设置类功能 = 设置弹窗分区**：注册 `settings.section` slot（`packages/access/src/client/index.tsx` 为参考实现——账号/用户管理/插件启停三分区）。上游设计宣言：adding a setting never means editing the shell（dsh-client-ui-settings contract/slots.d.ts）。
2. **UI 渲染统一走 `@eterna/ui` 设计令牌 `--et-*`**（v4「温润如玉」）：应用内插件面经 DSH 桥接层（`--dsw-alias-*`）跟随产品深浅主题；独立页用 v4 令牌块。禁止字面色值（仅 `packages/ui/src/tokens.ts`、品牌插画/图标资产、扩展设置页令牌块豁免）。**圆角只允许阶梯值**（8/12/16/22/28/36/pill），且嵌套必须满足同心弧（子 = 父 − 内距）。**正文禁止 `font-weight:500`**（只用 400/500/600 三档，500 仅强调）。图标统一走 `@eterna/ui/icons`（React）或 `@eterna/ui/icon-data`（服务端字符串），禁止上游图标、一次性手写 SVG 与 emoji 功能图标。参考 `packages/access/src/client/styles.ts`、`docs/design/design-tokens.md` 与 `docs/design/iconography.md`。
3. **叠层位置即语义**（v4 新增）：**决策层（工具审批/用户提问）贴输入卡顶边向上浮出**，禁止用顶部浮层或全屏遮罩；**toast 只在顶部中央**，走宿主 `ui-primitives` 的 `Toast` 原子或 `workspace.toast` 席位，禁止自建 toast 系统；**通知中心在设置分区**。三者永不同区。`z-index` 只允许 1/40/100/200/1000/1100/1500。
4. **交互纪律**：资料类字段合并保存（脏检查+单按钮）；密码等安全操作独立成卡；变更请求防重复点击；破坏性操作两击确认（禁用原生 `confirm()/alert()`）；HTML 响应 `no-store`。
5. **可访问性与响应式**：语义标题、focus 光圈、`prefers-reduced-motion`、1100/760/640px 断点（其它值一律打回）。**位置规则在任何宽度下不变，只有形态收缩**：<760 决策卡一次只呈 1 张（其余排队+切换条），侧栏隐藏，gutter 16；≥768 gutter 24。每屏强调色 ≤2 处可见，卡内正文 ≤3 行。
6. **客户端半边配方**：`dsh.client` 声明 + `build:client`（esbuild→`window.__ModuleLoader__` 工件）+ `ctx.slots.inject('settings.section', () => ctx.slots.register(...))`，panel 先例同构。

完整规范：[docs/design/frontend-style.md](docs/design/frontend-style.md)（v4，强制条目）。
设计依据与实测：[docs/design/42-前端视觉体系v4-温润如玉.md](docs/design/42-前端视觉体系v4-温润如玉.md)。
迁移工序：[docs/design/45-前端v4迁移开发计划.md](docs/design/45-前端v4迁移开发计划.md)。
新增 UI 的 PR 必须附**深浅两主题 × 1440/900/390 三视口**截图，按其 §7 清单逐条自查。

> **护栏全覆盖（2026-11-19）**：`scripts/lint-ui-tokens.mjs` 扫描面已从「手写 11 个
> 目录白名单」改为 `packages/*/src` **全覆盖 + 显式豁免清单**，文件过滤同时补上 `.js`
> （此前只收 `.ts/.tsx/.html`，纯 `.js` 的客户端半边整体逃检）。新包默认纳入检查——
> `knowledge-admin` 就是这样带病入库的：992 行、23 处字面色值、9 个**上游不存在**的
> `--dsw-alias-*` 令牌名，界面实际跑在电光蓝兜底、深浅主题都不跟随。
> 新建包**先跑** `node scripts/lint-ui-tokens.mjs`，绿了再提 PR。

## 多租户隔离铁律

见 [docs/PLUGIN-AUTHORING.md](docs/PLUGIN-AUTHORING.md) §1.1（`packctl tenant-scan` CI 强制）：
持久化在 DSH_HOME 语义下、路由面独占（eterna-access）、workspace 登记册独占写、
启停登记、R12 知悉。

## 工程纪律（既有约定）

- 数据不出内网（telemetry 裁）；凭据只入 `.secrets/` 与 `.env`（均 gitignored），绝不写入被跟踪文件/镜像/日志/argv；
- deepseek-harness 源仓库只读；git push 单独确认（除非用户当轮明确指示）；
- README/docs 每个数字必须实测可追溯，不编造；
- UI 面向用户文字一律中文。
