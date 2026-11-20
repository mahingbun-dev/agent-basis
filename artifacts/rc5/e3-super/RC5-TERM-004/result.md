# RC5-TERM-004 — B 用 A 的 sessionId：6 个 terminal unary 全部拒绝（TERM-004）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-20T07:02:49.069Z → 2026-11-20T07:02:49.490Z

## 预期（51/54 原文口径）

全部 403/deny；审计有记录

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-5a783479-0e64-4e82-9485-9041af63f8e2","agentPreset":"standard"} |
| PASS | 正向控制：A 读自己会话 environment 成功 | {"cwd":"/data/workspaces/Mr.Ma","maxInputBytes":65536,"maxBufferedBytes":2097152,"maxCols":500,"maxRows":200,"scrollback":1000} |
| PASS | 正向控制：A 读自己会话 shells 成功 | [{"path":"/bin/bash","name":"bash","args":["-i"]}] |
| PASS | user_b 夹具存在（E3 隔离数据根） | rc5userb |
| PASS | user_b 登录 200 | status=200 |
| PASS | B 用 A 的 sessionId 调 6 个 unary 全部 403/deny | all denied |
| PASS | B 未拿到 A 的 cwd/shells（无数据泄漏） | {"code":"remote-access/denied","message":"remote access: terminal/environment: access denied (no-allow)","details":{"action":"terminal/environment","reason":"no-allow"}} |

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

- 2026-11-20 复跑（终版镜像 ae5ce8cb）：B 的 6 个 unary 全被 remote-access/denied 拒绝，未再取到 A 的 cwd/shells。修复=packages/access/src/terminal.ts 跨会话守卫 + mux admit 换血 eterna-user principal；修复前泄漏证据存档 artifacts/rc5/E1/TERM/terminal-guard-report.pre-fix.json（历史，不再复现）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
