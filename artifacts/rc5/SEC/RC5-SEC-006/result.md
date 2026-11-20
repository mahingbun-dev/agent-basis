# RC5-SEC-006 — 审计日志无明文

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:324`（优先级 P0 / 方式 A）
- 执行时间：NOT RUN
- 命令与退出码：见 `cmd.log`
- 判定：**NOT RUN**

## 预期

grep secrets/headers/token，无明文；关键事件齐全。

## 实际

NOT RUN：需运行态审计 jsonl（P6/E2）。

## 断言

- [ ] 未执行（NOT RUN）

## 证据

