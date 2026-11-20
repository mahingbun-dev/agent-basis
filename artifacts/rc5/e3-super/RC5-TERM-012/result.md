# RC5-TERM-012 — 两会话各开终端互不可见（TERM-012）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**NOTRUN**
- 时间：2026-11-19T22:32:54.490Z → 2026-11-19T22:32:54.668Z

## 预期（51/54 原文口径）

互不可见/互不输入

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-a034094f-acab-4673-abcc-5294e8d0d270","agentPreset":"standard"} |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-e6dd5484-86c9-486c-9f9f-7c8f956dc89a","agentPreset":"standard"} |
| PASS | 两会话各自可建终端（隔离判定前置）缺失：create 均 gateway/internal | createA={"code":"gateway/internal","message":"session.snapshotEvents is not a function","details":{}} createB={"code":"gateway/internal","message":"session.snapshotEvents is not a function","details":{}} |
| PASS | 两会话的 terminal/list 均为空（无终端可比较） | list 返回 []（create 被阻断） |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/terminal/create` → exit=200（A 会话 1）
- `POST /api/terminal/create` → exit=200（A 会话 2）

## 备注

- terminal/create 被 gateway/internal（session.snapshotEvents is not a function）阻断，两会话无法各开终端 → 「互不可见/互不输入」不可判；前置与 TERM-006 同根。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
