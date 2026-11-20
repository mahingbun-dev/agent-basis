# WB-002 — （workbench）panel 挂载 + 客户端工件

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**PASS**
- 时间：2026-11-20T01:47:19.130Z → 2026-11-20T01:47:19.304Z

## 预期（51/54 原文口径）

行 active；花名册/工厂在

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | eterna-workbench 行 enabled+active | {"entryId":"include:eterna-workbench","moduleName":"@eterna/workbench","enabled":true,"fiberPhase":"active","meta":{"title":"@eterna/workbench","description":"Subagent 工作台(38 号 WS-D):panel 扩展形态挂载的 key |
| PASS | 花名册含 @eterna/workbench | entries=80 |
| PASS | workbench bundle 可取且含 factory | status=200 bytes=3233804 |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/pluginInventory/list` → exit=200
- `GET /` → exit=200（HTML 花名册（__DSH_BOOT__））
- `index.html combo urls parsed (83 chunks)` → exit=200
- `GET /plugins/??@eterna/attachments/client.js,@eterna/compaction/client.js,@deepseek-ai/dsh-api-remote-access/client.js,@deepseek-ai/dsh-session-log-export/client.js,@deepseek-ai/dsh-client-file-upload/client.js,@deepseek-ai/dsh-api-remotes/client.js,@deepseek-ai/dsh-client-ui-deliverables/client.js,@eterna/llm-doctor/client.js,@eterna/usage-stats/client.js,@eterna/knowledge-admin/client.js,@deepseek-ai/dsh-typert-registry/client.js,@deepseek-ai/dsh-client-connection/client.js,@eterna/prompt-studio/client.js,@deepseek-ai/dsh-api-workspace-controller/client.js,@deepseek-ai/dsh-deepseek-chat-import/client.js,@deepseek-ai/dsh-api-session-controller/client.js,@eterna/tasks/client.js,@eterna/memory/client.js,@eterna/panel/client.js,@eterna/workbench/client.js,@eterna/access/client.js&rev=292f111875c8` → exit=200（client bundle @eterna/workbench）

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
