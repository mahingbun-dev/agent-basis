# RC5-API-005 — 主会话派 2 个 worker：waitForTreeWork 等到全部完成（API-005）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**NOTRUN**
- 时间：2026-11-20T01:45:14.854Z → 2026-11-20T01:45:16.583Z

## 预期（51/54 原文口径）

E3 主会话派 2 worker；waitForTreeWork 全完成；无丢回执

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | 模型目录可读（证明路由在，但凭据另判） | {"provider":"mimo","model":"mimo-v2.6-pro"} |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-08922b03-5d58-4176-b076-39caeb5efca2","agentPreset":"standard"} |
| PASS | 模型探针如实记录失败原因（AUTH 401 invalid API Key） | {"kind":"error","error":{"message":"401: {\"message\":\"Invalid API Key\",\"param\":\"Please provide valid API Key\",\"code\":\"401\",\"type\":\"invalid_key\"}","code":"AUTH"}} |
| PASS | tasks 归属桥按 realm 对齐失败（realm=Mr.Ma 不在 access 用户表） | [eterna-tasks-access-bridge] realm「Mr.Ma」不在 access 用户表(realm 与登录账号名不对齐?),跳过主会话归属登记 |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/session/modelCatalog` → exit=200
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/session/prompt` → exit=200
- `session/prompt 载荷内容不写证据（仅一致性探针）` → exit=0
- `POST /api/session/page` → exit=200
- `GET /access/api/tasks/settings` → exit=200
- `docker logs eterna-rc5-e3` → exit=0（bridge 日志取 realm 登记事实）

## 备注

- tasks masterId=orchestrator-Mr.Ma realm=Mr.Ma
- E3 测试账号 rc5admin 与模板 realm=Mr.Ma 不对齐 → orchestrator 主会话未登记；API-005 的「主会话派 2 个 worker」在 E3 无法成立（P6 需真模型 + realm 对齐账号）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
