# RC5-API-007 — 排空后代后无残留 running（API-007）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**NOTRUN**
- 时间：2026-11-20T07:01:46.772Z → 2026-11-20T07:02:46.911Z

## 预期（51/54 原文口径）

drainDescendants 后无残留 running

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | worker 列表为空（drain 前置缺失） | [] |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=429
- `POST /login (admin from 0600 accounts file)` → exit=429（retry#1）
- `POST /login (admin from 0600 accounts file)` → exit=429（retry#2）
- `POST /login (admin from 0600 accounts file)` → exit=200（retry#3）
- `GET /access/api/tasks/session-roles` → exit=200

## 备注

- drainDescendants 需真实后代树；前置（模型/ realm）见 RC5-API-005。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
