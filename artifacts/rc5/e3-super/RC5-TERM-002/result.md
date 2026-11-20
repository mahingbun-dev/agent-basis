# RC5-TERM-002 — 侧栏 terminal 面板可见/可开/首次按键接管（TERM-002）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**NOTRUN**
- 时间：2026-11-19T22:29:56.168Z → 2026-11-19T22:29:56.435Z

## 预期（51/54 原文口径）

可见、可开、可输入；接管后 Agent 只读

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | terminal 侧栏 panel 行 active（UI 基质） | {"entryId":"include:ui-sidebar-terminal","moduleName":"@deepseek-ai/dsh-client-ui-sidebar-terminal","enabled":true,"fiberPhase":"active","meta":{"title":{"en":"ui-sidebar-terminal","de":"Anschlussfeld |
| PASS | terminal 面板 client bundle 可取 | status=200 bytes=5759732 |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/pluginInventory/list` → exit=200
- `GET /` → exit=200（HTML 花名册（__DSH_BOOT__））
- `index.html combo urls parsed (83 chunks)` → exit=200
- `GET /plugins/??@deepseek-ai/dsh-api-gateway/client.js,@deepseek-ai/dsh-client-ui-file-actions/client.js,@deepseek-ai/dsh-client-ui-context-menu/client.js,@deepseek-ai/dsh-api-job-controller/client.js,@deepseek-ai/dsh-api-terminal-controller/client.js,@deepseek-ai/dsh-api-workspace-files/client.js,@deepseek-ai/dsh-client-hmr/client.js,@deepseek-ai/dsh-cordis-client-runner/client.js,@deepseek-ai/dsh-client-ui-theme/client.js,@deepseek-ai/dsh-client-locale/client.js,@deepseek-ai/dsh-client-shortcuts/client.js,@deepseek-ai/dsh-client-ui-layout/client.js,@deepseek-ai/dsh-client-ui-renderer/client.js,@deepseek-ai/dsh-client-ui-session/client.js,@deepseek-ai/dsh-client-resources/client.js,@deepseek-ai/dsh-client-ui-sidebar/client.js,@deepseek-ai/dsh-client-ui-sidebar-right/client.js,@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client.js,@deepseek-ai/dsh-client-ui-sidebar-browser/client.js,@deepseek-ai/dsh-client-ui-sidebar-terminal/client.js,@deepseek-ai/dsh-client-ui-sidebar-files/client.js,@deepseek-ai/dsh-client-ui-settings/client.js,@deepseek-ai/dsh-client-ui-settings-general/client.js,@deepseek-ai/dsh-client-ui-settings-models/client.js,@deepseek-ai/dsh-client-ui-plugin-manager/client.js,@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client.js,@deepseek-ai/dsh-client-ui-conversation/client.js,@deepseek-ai/dsh-client-ui-approval/client.js,@deepseek-ai/dsh-message-quotes/client.js,@deepseek-ai/dsh-client-ui-chat/client.js,@deepseek-ai/dsh-client-ui-attachment/client.js,@deepseek-ai/dsh-client-ui-file-drag/client.js,@deepseek-ai/dsh-client-ui-tool/client.js,@deepseek-ai/dsh-client-ui-cordis/client.js,@deepseek-ai/dsh-client-ui-workspace/client.js,@deepseek-ai/dsh-client-ui-input-trigger/client.js,@deepseek-ai/dsh-client-ui-commands/client.js,@deepseek-ai/dsh-client-ui-skill/client.js,@deepseek-ai/dsh-client-ui-agent-team/client.js,@deepseek-ai/dsh-client-ui-subagent/client.js,@deepseek-ai/dsh-client-ui-reference/client.js,@deepseek-ai/dsh-client-ui-secret-mask/client.js,@deepseek-ai/dsh-client-ui-jobs/client.js,@deepseek-ai/dsh-client-ui-schedule/client.js,@deepseek-ai/dsh-client-ui-goal/client.js,@deepseek-ai/dsh-client-ui-model-selection/client.js,@deepseek-ai/dsh-client-ui-permission-presets/client.js,@deepseek-ai/dsh-client-ui-agent-preset/client.js,@deepseek-ai/dsh-client-ui-entry-customization/client.js,@deepseek-ai/dsh-client-ui-settings-shell/client.js,@deepseek-ai/dsh-client-ui-settings-agent-loop/client.js,@deepseek-ai/dsh-client-ui-settings-subagent/client.js,@deepseek-ai/dsh-client-ui-settings-web-search/client.js,@deepseek-ai/dsh-client-ui-plan/client.js,@deepseek-ai/dsh-client-ui-user-questions/client.js,@deepseek-ai/dsh-client-ui-trajectory/client.js,@deepseek-ai/dsh-client-ui-plugin-market/client.js,@eterna/brand/client.js&rev=670474e251b8` → exit=200（client bundle @deepseek-ai/dsh-client-ui-sidebar-terminal）

## 备注

- 侧栏 terminal 面板的「可见/可开/首次按键接管/Agent 只读」需真浏览器交互与输入；本轮不做（凭据边界见 E3-UI-002）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
