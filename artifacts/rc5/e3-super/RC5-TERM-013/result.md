# RC5-TERM-013 — 24h 浸泡：长进程 + attach/close 无 fd 泄漏（TERM-013）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**NOTRUN**
- 时间：2026-11-19T22:32:54.728Z → 2026-11-19T22:32:54.729Z

## 预期（51/54 原文口径）

窗口满 + fd/RSS 曲线平稳

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | 24h 浸泡窗口进行中（未满，不得判通过） | plannedEnd=2026-11-20T21:45:37.331Z now=2026-11-19T22:32:54.729Z samples=48 |
| PASS | 浸泡跑在 E1（eterna-rc5-e1/3108），非 E3 容器 | eterna-rc5-e1 |

## 命令原文（完整见 cmd.log）

- `read artifacts/rc5/p5/testbed/soak/meta-24h.json` → exit=0
- `read artifacts/rc5/p5/testbed/soak/term-013-24h.jsonl` → exit=0（samples=48）

## 备注

- P5 24h 浸泡在 E1 运行，plannedEndAt=2026-11-20T21:45:37.331Z；当前采样 48 条、窗口未满不得判过；且 churn=create 持续 fail（同 session.snapshotEvents 错误）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
