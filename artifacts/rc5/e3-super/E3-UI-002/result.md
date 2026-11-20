# E3-UI-002 — （lane 本地）真浏览器渲染截图（super 工作台/任务板/terminal 面板）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**NOTRUN**
- 时间：2026-11-20T07:04:59.854Z → 2026-11-20T07:04:59.854Z

## 预期（51/54 原文口径）

深浅两主题 × 1440/900/390 截图 + 控制台无错

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|

## 命令原文（完整见 cmd.log）


## 备注

- 真浏览器渲染（工作台五视图/任务板/terminal 面板）需把 0600 测试口令或会话 cookie 传入浏览器自动化；无论 argv、页面代码或日志都会使凭据落盘/落日志，违反本 lane 凭据纪律。替代证据：E3-UI-001 HTML、WB-002 花名册/工厂、WB-001 SSE 快照、RC5-TERM-002 面板行/bundle。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
