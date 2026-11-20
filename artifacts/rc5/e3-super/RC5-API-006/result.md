# RC5-API-006 — 查询后代列表与任务树一致（API-006）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**NOTRUN**
- 时间：2026-11-20T07:01:46.615Z → 2026-11-20T07:01:46.719Z

## 预期（51/54 原文口径）

listDescendants 返回与任务树一致

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | tasks 视图/角色面可读（引擎就绪） | master=orchestrator-Mr.Ma workers=[] |
| PASS | 当前无 worker 会话（无法观察后代树） | [] |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `GET /access/api/tasks/settings` → exit=200
- `GET /access/api/tasks/session-roles` → exit=200

## 备注

- listDescendants 属宿主 subagent 服务方法，无公开 RPC；需由真实 worker 树驱动。前置（模型/ realm）见 RC5-API-005。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
