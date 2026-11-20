# RC5-TERM-012 · 两会话各开终端：互不可见/互不输入

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:39.537Z / 2026-11-20T07:03:41.961Z

## 预期

各自 list 只见自己的终端；A 的跨会话 close 不伤 B 的终端；跨会话 rename 被拒

## 实际

created=true isolated=true cross_close_no_leak=true cross_rename_denied=true

## 备注

- 脚本：artifacts/rc5/E1/TERM/term-012.mjs（本 runner 现场执行）

## 证据附件

- `cmd.log`

## 执行命令

```
$ node artifacts/rc5/E1/TERM/term-012.mjs  # EXIT=0
```
