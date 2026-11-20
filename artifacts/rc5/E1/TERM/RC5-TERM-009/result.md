# RC5-TERM-009 · 长进程切页再回：进程存活、输出连续

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:32.914Z / 2026-11-20T07:03:38.268Z

## 预期

断开/重连 attach 后 PTY 仍 running；screen 恢复且 tick 序号在离开期间继续推进

## 实际

alive=true snapshot=true before=3 after=14

## 备注

- 脚本：artifacts/rc5/E1/TERM/term-009.mjs（本 runner 现场执行）

## 证据附件

- `cmd.log`

## 执行命令

```
$ node artifacts/rc5/E1/TERM/term-009.mjs  # EXIT=0
```
