# RC5-TERM-005 — attach/retain/watch 三流动作跨租户被拒（TERM-005）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-20T07:10:15.726Z → 2026-11-20T07:10:15.853Z

## 预期（51/54 原文口径）

流被拒；无数据泄漏

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | admin 测试工作区可解析（E3 users.db 只读） | 090d9317-36d5-40bd-b640-a2c6963652fe |
| PASS | 新建会话成功 | {"sessionId":"session-ae647840-3b93-4cb0-9703-914b0611af07","agentPreset":"standard"} |
| PASS | 流动作不在 HTTP unary 面（需 WS mux /api/remote.mux） | attach/retain/watch 均返回 arguments-invalid（说明非 unary 端点） |
| PASS | 同镜像 E2 lane：B 对 A 的 attach/retain/watch 三流全被 remote-access/denied | RC5-TERM-005a=PASS；RC5-TERM-005b=PASS；RC5-TERM-005c=PASS |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `POST /api/session/create` → exit=200（ok·workspace=090d9317…）
- `POST /api/terminal/attach` → exit=200（A（HTTP unary 形态））
- `terminal/attach unary 形态` → exit=200（gateway/arguments-invalid）
- `POST /api/terminal/retain` → exit=200（A（HTTP unary 形态））
- `terminal/retain unary 形态` → exit=200（gateway/arguments-invalid）
- `POST /api/terminal/watch` → exit=200（A（HTTP unary 形态））
- `terminal/watch unary 形态` → exit=200（gateway/arguments-invalid）

## 备注

- 流通道跨租户判定由同镜像 E2 lane 的 WS mux 证据给出（005a/b/c 全 remote-access/denied，artifacts/rc5/E2/TERM/summary.json）；E3 本 lane 不重复建 WS 客户端。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
