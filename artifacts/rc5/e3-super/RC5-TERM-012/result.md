# RC5-TERM-012 — 两会话各开终端互不可见（TERM-012）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-20T07:03:50.371Z → 2026-11-20T07:03:52.641Z

## 预期（51/54 原文口径）

各自 list 只见自己的终端；跨会话 rename 被拒；close 不伤对方终端

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-9a760350-407d-4e63-b401-36a2b494f6e2","agentPreset":"standard"} |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-a8237cbd-61aa-44b2-afa6-2393bf51744c","agentPreset":"standard"} |
| PASS | 两个会话各自建出终端（隔离判定前置） | A=true B=true |
| PASS | 各自 list 只见自己的终端（互不可见） | A=["e3-t12-a"] B=["e3-t12-b"] |
| PASS | 跨会话 rename 被拒（terminal/unavailable） | {"code":"terminal/unavailable","message":"Terminal no longer exists in this Session","details":{}} |
| PASS | 跨会话 close 不伤及 B 的终端（仍 running、标题未变） | close.ok=true before=running/bash after=running/bash |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/terminal/create` → exit=200（会话 A create）
- `POST /api/terminal/create` → exit=200（会话 B create）
- `POST /api/terminal/list` → exit=200（A list）
- `POST /api/terminal/list` → exit=200（B list）
- `POST /api/terminal/rename` → exit=200（A 改名 B 的终端）
- `POST /api/terminal/close` → exit=200（A 关 B 的终端）
- `POST /api/terminal/list` → exit=200（B 复验）
- `POST /api/terminal/close` → exit=200（cleanup close A）
- `POST /api/terminal/close` → exit=200（cleanup close B）

## 备注

- 判定面=list 归属隔离 + 跨会话 rename 拒绝 + 跨会话 close 回看（B 终端不被改动）；输入面 attach 属流通道，见 TERM-005。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
