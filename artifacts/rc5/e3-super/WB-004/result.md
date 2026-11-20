# WB-004 — （workbench）tasks↔workbench 主会话/健康面链路

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**PASS**
- 时间：2026-11-20T07:03:59.471Z → 2026-11-20T07:04:59.665Z

## 预期（51/54 原文口径）

masterSessionId 一致；tickets 数组；health 可见

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | workbench masterSessionId 与 tasks masterId 一致 | workbench=orchestrator-Mr.Ma tasks=orchestrator-Mr.Ma |
| PASS | tasks health.state=ready 且 master 组件 ready（工作台数据面） | realm Mr.Ma 就绪 |
| PASS | 快照 tickets 为数组（空树也合法） | tickets=0 |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=429
- `POST /login (admin from 0600 accounts file)` → exit=429（retry#1）
- `POST /login (admin from 0600 accounts file)` → exit=429（retry#2）
- `POST /login (admin from 0600 accounts file)` → exit=200（retry#3）
- `GET /access/api/tasks/settings` → exit=200
- `GET /workbench/api/stream` → exit=200（SSE 首帧）

## 备注

- DomainEvents → 增量帧需真实工单流转（API-005 NOTRUN）；本用例只证快照-主会话-健康面链路。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
