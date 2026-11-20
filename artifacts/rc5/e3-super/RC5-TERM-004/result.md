# RC5-TERM-004 — B 用 A 的 sessionId：6 个 terminal unary 全部拒绝（TERM-004）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**FAIL**
- 时间：2026-11-19T22:33:40.039Z → 2026-11-19T22:33:40.254Z

## 预期（51/54 原文口径）

全部 403/deny；审计有记录

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-6a592a9d-0515-4f33-8c04-0d5563ff290b","agentPreset":"standard"} |
| PASS | 正向控制：A 读自己会话 environment 成功 | {"cwd":"/data/workspaces/Mr.Ma","maxInputBytes":65536,"maxBufferedBytes":2097152,"maxCols":500,"maxRows":200,"scrollback":1000} |
| PASS | 正向控制：A 读自己会话 shells 成功 | [{"path":"/bin/bash","name":"bash","args":["-i"]}] |
| PASS | user_b 夹具存在（E3 隔离数据根） | rc5userb |
| PASS | user_b 登录 200 | status=200 |
| FAIL | B 用 A 的 sessionId 调 6 个 unary 全部 403/deny | 未拒绝=environment,shells,list,create,rename,close :: environment: {"cwd":"/data/workspaces/Mr.Ma","maxInputBytes":65536,"maxBufferedBytes":2097152,"maxCols":500,"maxRows":200,"scrollback":1000} \| shells: [{"path":"/bin/bash","name":"bash","args":["-i"]}] \| list: [] \| create: {"code":"gateway/internal","message":"session.snapshotEvents is not a function","details":{}} \| rename: {"code":"terminal/ |
| FAIL | B 未拿到 A 的 cwd/shells（无数据泄漏） | {"cwd":"/data/workspaces/Mr.Ma","maxInputBytes":65536,"maxBufferedBytes":2097152,"maxCols":500,"maxRows":200,"scrollback":1000} |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/terminal/environment` → exit=200（A 正向控制）
- `POST /api/terminal/shells` → exit=200（A 正向控制）
- `GET /access/api/users` → exit=200（seeding 前置：用户清单）
- `POST /login (user_b from 0600 accounts file)` → exit=200
- `POST /api/terminal/environment` → exit=200（B 打 A 的 sessionId）
- `POST /api/terminal/shells` → exit=200（B 打 A 的 sessionId）
- `POST /api/terminal/list` → exit=200（B 打 A 的 sessionId）
- `POST /api/terminal/create` → exit=200（B 打 A 的 sessionId）
- `POST /api/terminal/rename` → exit=200（B 打 A 的 sessionId）
- `POST /api/terminal/close` → exit=200（B 打 A 的 sessionId）

## 备注

- P0：B 实测拿到 A 的会话 cwd 与 /bin/bash shells（见 detail 字段），list/close 未被拒、rename 返回 terminal/unavailable（存在性 oracle）、create 被内部错误挡住；与 P5 的 terminal unary 跨租户泄漏同根：packages/access/src/terminal.ts 守卫只对 principal.kind=eterna-user 生效。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
