# profiles/eterna-web — Eterna 企业 Web 档裁切层

`cordis.patch.yml`：叠在 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`
两个 bundle 层之上的企业裁切覆写层（裸 id 行覆写既有行，`disabled: true`=裁、
`disabled: false`=回加；文末另有两个 `- insert:` 新增块：mcp-browser（companion
浏览器执行面）与 eterna-prompt-studio（提示词工作室，T1.2），见各自段注）。

- 裁了什么/为什么/如何回加：见 [`docs/eterna-web-profile.md`](../../docs/eterna-web-profile.md)。
- 权威依据：`plans/2026-11-06-dsh企业agent路线定案.md` §11（§11.7、§11.8 为准）。
- 真 boot 验证：`node scripts/verify-eterna-web.mjs`（脚本会把本文件物化为
  `$DSH_HOME/profiles/eterna-web/cordis.patch.yml`，默认 home 为 `.eterna-home/`）。

组合栈（从下到上）：

1. `@deepseek-ai/dsh-base`（bundle 层，装品 0.2.2-rc.1）
2. `@deepseek-ai/dsh-web-app`（bundle 层 + 其 presets/*.patch.yml）
3. 本 `cordis.patch.yml`（profile 用户层，最后写赢）
