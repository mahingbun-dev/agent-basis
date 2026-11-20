# RC5-BOOT-013 — agent-team 三行与 Team mode（BOOT-013）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**PASS**
- 时间：2026-11-19T22:26:34.046Z → 2026-11-19T22:26:34.473Z

## 预期（51/54 原文口径）

三行真 boot；Team mode 默认关；任务板/子代理 UI 不破面（花名册/工厂/工件面）

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | agent-team 三行真 boot（enabled+active） | include:agent-team:@deepseek-ai/dsh-agent-team, include:tool-agent-team:@deepseek-ai/dsh-tool-agent-team, include:ui-agent-team:@deepseek-ai/dsh-client-ui-agent-team |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-ac2ffef7-8879-448f-a436-52a7b8a4103d","agentPreset":"standard"} |
| PASS | Team mode 默认关（新会话 agentTeam.enabled=false） | agentTeam={"enabled":false,"tasks":[]} |
| PASS | 花名册含 ui-agent-team（任务板/子代理 UI 半边） | entries=80 |
| PASS | ui-agent-team bundle 可取且含 factory 注册 | status=200 bytes=5759732 |
| PASS | 花名册含 @eterna/tasks 客户端半边 | entries=80 |
| PASS | @eterna/tasks bundle 可取且含 factory 注册 | status=200 bytes=3233804 |
| PASS | 花名册含 @eterna/workbench 客户端半边 | entries=80 |
| PASS | @eterna/workbench bundle 可取且含 factory 注册 | status=200 bytes=3233804 |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200（account=rc5admin）
- `POST /api/pluginInventory/list` → exit=200（ok=true）
- `POST /api/session/create` → exit=200（ok=true）
- `POST /api/session/projections` → exit=200（ok=true）
- `GET /` → exit=200（HTML 花名册（__DSH_BOOT__））
- `index.html combo urls parsed (83 chunks)` → exit=200
- `GET /plugins/??@deepseek-ai/dsh-api-gateway/client.js,@deepseek-ai/dsh-client-ui-file-actions/client.js,@deepseek-ai/dsh-client-ui-context-menu/client.js,@deepseek-ai/dsh-api-job-controller/client.js,@deepseek-ai/dsh-api-terminal-controller/client.js,@deepseek-ai/dsh-api-workspace-files/client.js,@deepseek-ai/dsh-client-hmr/client.js,@deepseek-ai/dsh-cordis-client-runner/client.js,@deepseek-ai/dsh-client-ui-theme/client.js,@deepseek-ai/dsh-client-locale/client.js,@deepseek-ai/dsh-client-shortcuts/client.js,@deepseek-ai/dsh-client-ui-layout/client.js,@deepseek-ai/dsh-client-ui-renderer/client.js,@deepseek-ai/dsh-client-ui-session/client.js,@deepseek-ai/dsh-client-resources/client.js,@deepseek-ai/dsh-client-ui-sidebar/client.js,@deepseek-ai/dsh-client-ui-sidebar-right/client.js,@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client.js,@deepseek-ai/dsh-client-ui-sidebar-browser/client.js,@deepseek-ai/dsh-client-ui-sidebar-terminal/client.js,@deepseek-ai/dsh-client-ui-sidebar-files/client.js,@deepseek-ai/dsh-client-ui-settings/client.js,@deepseek-ai/dsh-client-ui-settings-general/client.js,@deepseek-ai/dsh-client-ui-settings-models/client.js,@deepseek-ai/dsh-client-ui-plugin-manager/client.js,@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client.js,@deepseek-ai/dsh-client-ui-conversation/client.js,@deepseek-ai/dsh-client-ui-approval/client.js,@deepseek-ai/dsh-message-quotes/client.js,@deepseek-ai/dsh-client-ui-chat/client.js,@deepseek-ai/dsh-client-ui-attachment/client.js,@deepseek-ai/dsh-client-ui-file-drag/client.js,@deepseek-ai/dsh-client-ui-tool/client.js,@deepseek-ai/dsh-client-ui-cordis/client.js,@deepseek-ai/dsh-client-ui-workspace/client.js,@deepseek-ai/dsh-client-ui-input-trigger/client.js,@deepseek-ai/dsh-client-ui-commands/client.js,@deepseek-ai/dsh-client-ui-skill/client.js,@deepseek-ai/dsh-client-ui-agent-team/client.js,@deepseek-ai/dsh-client-ui-subagent/client.js,@deepseek-ai/dsh-client-ui-reference/client.js,@deepseek-ai/dsh-client-ui-secret-mask/client.js,@deepseek-ai/dsh-client-ui-jobs/client.js,@deepseek-ai/dsh-client-ui-schedule/client.js,@deepseek-ai/dsh-client-ui-goal/client.js,@deepseek-ai/dsh-client-ui-model-selection/client.js,@deepseek-ai/dsh-client-ui-permission-presets/client.js,@deepseek-ai/dsh-client-ui-agent-preset/client.js,@deepseek-ai/dsh-client-ui-entry-customization/client.js,@deepseek-ai/dsh-client-ui-settings-shell/client.js,@deepseek-ai/dsh-client-ui-settings-agent-loop/client.js,@deepseek-ai/dsh-client-ui-settings-subagent/client.js,@deepseek-ai/dsh-client-ui-settings-web-search/client.js,@deepseek-ai/dsh-client-ui-plan/client.js,@deepseek-ai/dsh-client-ui-user-questions/client.js,@deepseek-ai/dsh-client-ui-trajectory/client.js,@deepseek-ai/dsh-client-ui-plugin-market/client.js,@eterna/brand/client.js&rev=670474e251b8` → exit=200（client bundle @deepseek-ai/dsh-client-ui-agent-team）
- `GET /plugins/??@eterna/attachments/client.js,@eterna/compaction/client.js,@deepseek-ai/dsh-api-remote-access/client.js,@deepseek-ai/dsh-session-log-export/client.js,@deepseek-ai/dsh-client-file-upload/client.js,@deepseek-ai/dsh-api-remotes/client.js,@deepseek-ai/dsh-client-ui-deliverables/client.js,@eterna/llm-doctor/client.js,@eterna/usage-stats/client.js,@eterna/knowledge-admin/client.js,@deepseek-ai/dsh-typert-registry/client.js,@deepseek-ai/dsh-client-connection/client.js,@eterna/prompt-studio/client.js,@deepseek-ai/dsh-api-workspace-controller/client.js,@deepseek-ai/dsh-deepseek-chat-import/client.js,@deepseek-ai/dsh-api-session-controller/client.js,@eterna/tasks/client.js,@eterna/memory/client.js,@eterna/panel/client.js,@eterna/workbench/client.js,@eterna/access/client.js&rev=3a1bee1f9a66` → exit=200（client bundle @eterna/tasks）

## 备注

- UI 渲染面（真浏览器像素/交互）未在本用例判定；见 E3-UI-002（NOTRUN，凭据边界）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
