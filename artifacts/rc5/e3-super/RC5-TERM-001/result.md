# RC5-TERM-001 — profile bundle 清单含 terminal bundle（TERM-001）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-19T22:27:56.200Z → 2026-11-19T22:27:56.452Z

## 预期（51/54 原文口径）

dsh-experimental-terminal-bundle 在；terminal 行 active

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | profile bundles 含 dsh-experimental-terminal-bundle | "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-deepseek-chat-import", "@deepseek-ai/dsh-experimental-session-search", "@deepseek-ai/dsh-experimental-plugin-market-bundle", "@deepseek-ai/dsh-experimental-terminal-bundle" |
| PASS | admin 登录 200 | status=200 |
| PASS | terminal 行集 active（registry/panel/tool/controller/ui） | include:terminal-controller, include:ui-sidebar-terminal, include:optional-terminal-registry, include:optional-terminal-panel, include:optional-tool-terminal |

## 命令原文（完整见 cmd.log）

- `docker exec eterna-rc5-e3 cat /data/profiles/eterna-super/package.json` → exit=0（profile package.json）
- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200（account=rc5admin）
- `POST /api/pluginInventory/list` → exit=200（ok=true）

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
