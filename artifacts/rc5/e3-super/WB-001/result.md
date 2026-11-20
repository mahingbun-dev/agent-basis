# WB-001 — （workbench）实时流首帧快照契约

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**PASS**
- 时间：2026-11-20T07:03:52.787Z → 2026-11-20T07:03:52.905Z

## 预期（51/54 原文口径）

200 SSE；snapshot 含 10 键；masterSessionId=orchestrator-*

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | SSE 200 text/event-stream | 200 text/event-stream; charset=utf-8 |
| PASS | 首帧 kind=snapshot | snapshot |
| PASS | 快照含五视图/检查器 10 个数据键 | tickets,conflict,logs,eval,flow,worker,sessions,assignments,timelines,masterSessionId |
| PASS | masterSessionId 为 tasks 主会话 | orchestrator-Mr.Ma |
| PASS | flow 节点/worker 分列投影在场 | flowNodes=7 |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `GET /workbench/api/stream` → exit=200（SSE 首帧）

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
