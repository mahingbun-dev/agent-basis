# RC5-BOOT-012 — 浏览器加载：10 个产品 client bundle 无版本不匹配（BOOT-012 → workbench 回归面）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-20T01:45:08.023Z → 2026-11-20T01:45:08.263Z

## 预期（51/54 原文口径）

release.version=0.2.2-rc.5；10 包花名册/工件/工厂齐全；rev 一致

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | index.html 注入 __DSH_BOOT__ 且 release.version=0.2.2-rc.5 | release=0.2.2-rc.5 dsh=0.2.2-rc.5 |
| PASS | T36 10 个产品 client bundle 在册/可取/工厂注册/rev 一致 | access, attachments, brand, compaction, llm-doctor, memory, panel, prompt-studio, usage-stats, workbench |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `docker exec eterna-rc5-e3 dsh --version` → exit=0（release.version 对照）
- `GET /` → exit=200（HTML 花名册（__DSH_BOOT__））
- `index.html combo urls parsed (83 chunks)` → exit=200
- `GET /plugins/??@eterna/attachments/client.js,@eterna/compaction/client.js,@deepseek-ai/dsh-api-remote-access/client.js,@deepseek-ai/dsh-session-log-export/client.js,@deepseek-ai/dsh-client-file-upload/client.js,@deepseek-ai/dsh-api-remotes/client.js,@deepseek-ai/dsh-client-ui-deliverables/client.js,@eterna/llm-doctor/client.js,@eterna/usage-stats/client.js,@eterna/knowledge-admin/client.js,@deepseek-ai/dsh-typert-registry/client.js,@deepseek-ai/dsh-client-connection/client.js,@eterna/prompt-studio/client.js,@deepseek-ai/dsh-api-workspace-controller/client.js,@deepseek-ai/dsh-deepseek-chat-import/client.js,@deepseek-ai/dsh-api-session-controller/client.js,@eterna/tasks/client.js,@eterna/memory/client.js,@eterna/panel/client.js,@eterna/workbench/client.js,@eterna/access/client.js&rev=292f111875c8` → exit=200（client bundle @eterna/access）
- `GET /plugins/??@deepseek-ai/dsh-api-gateway/client.js,@deepseek-ai/dsh-client-ui-file-actions/client.js,@deepseek-ai/dsh-client-ui-context-menu/client.js,@deepseek-ai/dsh-api-job-controller/client.js,@deepseek-ai/dsh-api-terminal-controller/client.js,@deepseek-ai/dsh-api-workspace-files/client.js,@deepseek-ai/dsh-client-hmr/client.js,@deepseek-ai/dsh-cordis-client-runner/client.js,@deepseek-ai/dsh-client-ui-theme/client.js,@deepseek-ai/dsh-client-locale/client.js,@deepseek-ai/dsh-client-shortcuts/client.js,@deepseek-ai/dsh-client-ui-layout/client.js,@deepseek-ai/dsh-client-ui-renderer/client.js,@deepseek-ai/dsh-client-ui-session/client.js,@deepseek-ai/dsh-client-resources/client.js,@deepseek-ai/dsh-client-ui-sidebar/client.js,@deepseek-ai/dsh-client-ui-sidebar-right/client.js,@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client.js,@deepseek-ai/dsh-client-ui-sidebar-browser/client.js,@deepseek-ai/dsh-client-ui-sidebar-terminal/client.js,@deepseek-ai/dsh-client-ui-sidebar-files/client.js,@deepseek-ai/dsh-client-ui-settings/client.js,@deepseek-ai/dsh-client-ui-settings-general/client.js,@deepseek-ai/dsh-client-ui-settings-models/client.js,@deepseek-ai/dsh-client-ui-plugin-manager/client.js,@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client.js,@deepseek-ai/dsh-client-ui-conversation/client.js,@deepseek-ai/dsh-client-ui-approval/client.js,@deepseek-ai/dsh-message-quotes/client.js,@deepseek-ai/dsh-client-ui-chat/client.js,@deepseek-ai/dsh-client-ui-attachment/client.js,@deepseek-ai/dsh-client-ui-file-drag/client.js,@deepseek-ai/dsh-client-ui-tool/client.js,@deepseek-ai/dsh-client-ui-cordis/client.js,@deepseek-ai/dsh-client-ui-workspace/client.js,@deepseek-ai/dsh-client-ui-input-trigger/client.js,@deepseek-ai/dsh-client-ui-commands/client.js,@deepseek-ai/dsh-client-ui-skill/client.js,@deepseek-ai/dsh-client-ui-agent-team/client.js,@deepseek-ai/dsh-client-ui-subagent/client.js,@deepseek-ai/dsh-client-ui-reference/client.js,@deepseek-ai/dsh-client-ui-secret-mask/client.js,@deepseek-ai/dsh-client-ui-jobs/client.js,@deepseek-ai/dsh-client-ui-schedule/client.js,@deepseek-ai/dsh-client-ui-goal/client.js,@deepseek-ai/dsh-client-ui-model-selection/client.js,@deepseek-ai/dsh-client-ui-permission-presets/client.js,@deepseek-ai/dsh-client-ui-agent-preset/client.js,@deepseek-ai/dsh-client-ui-entry-customization/client.js,@deepseek-ai/dsh-client-ui-settings-shell/client.js,@deepseek-ai/dsh-client-ui-settings-agent-loop/client.js,@deepseek-ai/dsh-client-ui-settings-subagent/client.js,@deepseek-ai/dsh-client-ui-settings-web-search/client.js,@deepseek-ai/dsh-client-ui-plan/client.js,@deepseek-ai/dsh-client-ui-user-questions/client.js,@deepseek-ai/dsh-client-ui-trajectory/client.js,@deepseek-ai/dsh-client-ui-plugin-market/client.js,@eterna/brand/client.js&rev=5b2e9df9f00d` → exit=200（client bundle @eterna/brand）

## 备注

- 控制台「版本不匹配」错误需真浏览器复现；本用例以 release.version + entry.rev + 工件可取性代替（W5 既有口径）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
