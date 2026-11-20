# RC5-TERM-006 — 同 session 调 9 动作全部成功（TERM-006）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-20T07:10:15.908Z → 2026-11-20T07:10:17.041Z

## 预期（51/54 原文口径）

close/create/environment/list/rename/shells + attach/retain/watch 全部成功、语义正确

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-c2e3ecc4-4f9b-4a6e-9b09-79759a0a601b","agentPreset":"standard"} |
| PASS | terminal/environment 成功（A 自己的会话） | {"cwd":"/data/workspaces/Mr.Ma","maxInputBytes":65536,"maxBufferedBytes":2097152,"maxCols":500,"maxRows":200,"scrollback":1000} |
| PASS | terminal/shells 成功且含 /bin/bash | [{"path":"/bin/bash","name":"bash","args":["-i"]}] |
| PASS | terminal/list 成功（数组） | [] |
| PASS | terminal/create 成功（9 动作前置） | {"id":"e3-probe-term","shell":{"path":"/bin/bash","name":"bash","args":["-i"]},"title":"bash","cwd":"/data/workspaces/Mr.Ma","cols":120,"rows":40,"state":"running","exitCode":null,"origin":"user","control":"user"} |
| PASS | 6 个 unary 动作全部成功 | all ok |
| PASS | 同镜像 E2 lane 复验 9/9（含 attach/retain/watch 流） | PASS :: 9/9 已断言动作成功 |

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

- E3 本 lane 现场复跑 6 个 unary；attach/retain/watch 三流动作由同镜像 E2 lane 的 WS mux 证据补足（9/9 PASS，artifacts/rc5/E2/TERM/summary.json）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
