# RC5-TERM-013 — 24h 浸泡：长进程 + attach/close 无 fd 泄漏（TERM-013）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**NOTRUN**
- 时间：2026-11-20T07:03:52.704Z → 2026-11-20T07:03:52.705Z

## 预期（51/54 原文口径）

24h 窗口完成 + fd/RSS 曲线平稳 + churn 全 ok

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | 浸泡窗存在且在终版镜像 lane（eterna-rc5-e1）上起跑 | eterna-rc5-e1 |
| PASS | 已有采样（窗口正在运行） | samples=61 |
| PASS | churn（create→WS attach→close）历史采样全 ok | fail=0/61 |

## 命令原文（完整见 cmd.log）

- `read artifacts/rc5/p6b/soak/final-image/meta-24h-final.json` → exit=0（plannedEnd=2026-11-21T05:06:19.450Z container=eterna-rc5-e1）
- `read artifacts/rc5/p6b/soak/final-image/term-013-24h-final.jsonl` → exit=0（samples=61）

## 备注

- 24h 窗口未满：plannedEndAt=2026-11-21T05:06:19.450Z（now=2026-11-20T07:03:52.705Z），summary 未落盘；按 54 §6.3 记 NOTRUN，不得预先判过。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
