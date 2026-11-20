# RC5-TERM-005 · attach/retain/watch 三个流动作跨租户被拒

- 套件：TERM
- 结论：**SKIP**
- 开始/结束：2026-11-20T01:42:00.729Z / 2026-11-20T01:42:00.729Z

## 预期

流被拒；无数据泄漏

## 实际

未执行：套件已在 004 中止；脚本仅做静态策略清单核对（通过），流拒绝需 WS mux 客户端

## 备注

- RC5-TERM-004 跨租户红（B 可读 A 会话终端）→ 按派发规则立即中止 TERM 套件
- WS mux 流拒绝可在 P6 补测（本 lane 已有 _lib/ws.mjs 但按停止规则不继续）

## 证据附件

- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs ...（TERM-005 行）  # EXIT=0
```
