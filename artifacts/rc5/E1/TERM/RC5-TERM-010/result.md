# RC5-TERM-010 · close 后再 attach：状态正确、无幽灵终端

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:38.268Z / 2026-11-20T07:03:39.537Z

## 预期

attach/retain 拒绝、list 不含该 id、同 id 不能复活（closedIds 生效）

## 实际

attach=error/terminal/unavailable retain=error/terminal/unavailable absent=true resurrect=false

## 备注

- 脚本：artifacts/rc5/E1/TERM/term-010.mjs（本 runner 现场执行）

## 证据附件

- `cmd.log`

## 执行命令

```
$ node artifacts/rc5/E1/TERM/term-010.mjs  # EXIT=0
```
