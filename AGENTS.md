# AGENTS.md — EternaAgent 仓库开发规则

> 本文件对所有在本仓库工作的 AI 助手与人类开发者生效。违反 = 审查打回。

## 前端与产品形态铁律（2026-11-10 起，用户强制要求）

**产品内功能一律做成 dsh 原生扩展点插件，禁止自建独立页面入口**（登录门禁页 /login 是唯一例外）：

1. **设置类功能 = 设置弹窗分区**：注册 `settings.section` slot（`packages/access/src/client/index.tsx` 为参考实现——账号/用户管理/插件启停三分区）。上游设计宣言：adding a setting never means editing the shell（dsh-client-ui-settings contract/slots.d.ts）。
2. **UI 渲染用 DSH 官方语义令牌 `--dsw-alias-*`**：深浅主题自动跟随产品，禁止字面色值（品牌渐变头像唯一豁免）。参考 `packages/access/src/client/styles.ts`。
3. **交互纪律**：资料类字段合并保存（脏检查+单按钮）；密码等安全操作独立成卡；变更请求防重复点击；破坏性操作两击确认（禁用原生 `confirm()/alert()`）；HTML 响应 `no-store`。
4. **可访问性与响应式**：语义标题、focus 光圈、`prefers-reduced-motion`、640/760px 断点。
5. **客户端半边配方**：`dsh.client` 声明 + `build:client`（esbuild→`window.__ModuleLoader__` 工件）+ `ctx.slots.inject('settings.section', () => ctx.slots.register(...))`，panel 先例同构。

完整规范：[docs/design/frontend-style.md](docs/design/frontend-style.md)。新增 UI 的 PR 必须附深浅两主题截图，按其 §4 清单自查。

## 多租户隔离铁律

见 [docs/PLUGIN-AUTHORING.md](docs/PLUGIN-AUTHORING.md) §1.1（`packctl tenant-scan` CI 强制）：
持久化在 DSH_HOME 语义下、路由面独占（eterna-access）、workspace 登记册独占写、
启停登记、R12 知悉。

## 工程纪律（既有约定）

- 数据不出内网（telemetry 裁）；凭据只入 `.secrets/` 与 `.env`（均 gitignored），绝不写入被跟踪文件/镜像/日志/argv；
- deepseek-harness 源仓库只读；git push 单独确认（除非用户当轮明确指示）；
- README/docs 每个数字必须实测可追溯，不编造；
- UI 面向用户文字一律中文。
