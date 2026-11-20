# E3-UI-001 — （lane 本地）super 形态 UI 入口工件

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**PASS**
- 时间：2026-11-19T22:31:11.390Z → 2026-11-19T22:31:11.428Z

## 预期（51/54 原文口径）

/login 200，v4 令牌块与中文登录文案

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | 登录页 200 且为 v4 令牌块 HTML | status=200 bytes=21095 |
| PASS | 登录页中文文案（账号/密码/登录） | yes |

## 命令原文（完整见 cmd.log）

- `GET /login` → exit=200（公开登录页（无凭据））

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
