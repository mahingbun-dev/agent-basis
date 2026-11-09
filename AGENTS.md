# AGENTS.md — EternaAgent 仓库开发规则

> 本文件对所有在本仓库工作的 AI 助手与人类开发者生效。违反 = 审查打回。

## 前端风格铁律（2026-11-10 起，用户强制要求）

**所有面向用户的页面（access 服务端页 / panel / prompt-studio 浏览器半边 / 任何插件 UI）
必须遵循 [docs/design/frontend-style.md](docs/design/frontend-style.md)（eterna 前端风格规范 v1）**：

1. 颜色只用规范令牌表（深色默认匹配 dsh 应用 `#151517`，浅色经 `prefers-color-scheme` 适配）——禁止硬编码色值；
2. 独立页面复用 access `shell()` 同构骨架（sticky 毛玻璃 topbar：品牌=返回应用 + 身份 + 退出；main 居中卡）——禁止再造导航；
3. 交互纪律：资料类字段合并保存（脏检查+单一「保存更改」），密码等安全操作独立成卡，变更请求防重复点击，破坏性操作两击确认（禁用原生 `confirm()/alert()`），服务端页 `no-store`；
4. 可访问性与响应式按规范 §1.5/§1.6（640px 断点、reduced-motion、focus-visible）。

参考实现与令牌表：`packages/access/src/pages.ts`（STYLE + shell()）。新增页面/改版 PR 必须附深浅两主题截图，按规范 §4 清单自查。

## 多租户隔离铁律

见 [docs/PLUGIN-AUTHORING.md](docs/PLUGIN-AUTHORING.md) §1.1（`packctl tenant-scan` CI 强制）：
持久化在 DSH_HOME 语义下、路由面独占（eterna-access）、workspace 登记册独占写、
启停登记、R12 知悉。

## 工程纪律（既有约定）

- 数据不出内网（telemetry 裁）；凭据只入 `.secrets/` 与 `.env`（均 gitignored），绝不写入被跟踪文件/镜像/日志/argv；
- deepseek-harness 源仓库只读；git push 单独确认（除非用户当轮明确指示）；
- README/docs 每个数字必须实测可追溯，不编造；
- UI 面向用户文字一律中文。
