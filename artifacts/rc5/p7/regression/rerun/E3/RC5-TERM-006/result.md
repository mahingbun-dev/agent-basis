# RC5-TERM-006 — 同 session 调 9 动作全部成功（TERM-006）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**FAIL**
- 时间：2026-11-20T01:46:17.681Z → 2026-11-20T01:46:17.841Z

## 预期（51/54 原文口径）

close/create/environment/list/rename/shells + attach/retain/watch 全部成功、语义正确

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-10cd7f83-70ee-43da-a9bd-e2ec5b8baf11","agentPreset":"standard"} |
| PASS | terminal/environment 成功（A 自己的会话） | {"cwd":"/data/workspaces/Mr.Ma","maxInputBytes":65536,"maxBufferedBytes":2097152,"maxCols":500,"maxRows":200,"scrollback":1000} |
| PASS | terminal/shells 成功且含 /bin/bash | [{"path":"/bin/bash","name":"bash","args":["-i"]}] |
| PASS | terminal/list 成功（数组） | [] |
| FAIL | terminal/create 成功（9 动作前置） | {"code":"gateway/internal","message":"session.snapshotEvents is not a function","details":{}} |
| FAIL | 6 个 unary 动作全部成功 | failed=create,rename |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/terminal/environment` → exit=200（A）
- `POST /api/terminal/shells` → exit=200（A）
- `POST /api/terminal/list` → exit=200（A）
- `POST /api/terminal/create` → exit=200（A）
- `POST /api/terminal/rename` → exit=200（A）
- `POST /api/terminal/close` → exit=200（A）

## 备注

- terminal/create 服务端内部错误（session.snapshotEvents is not a function）与 P5 结论一致：rename/close 无 terminal id 可作用，attach/retain/watch 亦无法建立目标终端。
- attach/retain/watch 三个流动作需 WS mux（/api/remote.mux）；本用例未建立 WS 客户端，按 NOTRUN 记（同 P5 口径）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
