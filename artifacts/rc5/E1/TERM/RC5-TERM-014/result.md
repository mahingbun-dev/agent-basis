# RC5-TERM-014 · shell 不存在时明确报错、容器不崩

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:41.961Z / 2026-11-20T07:03:42.237Z

## 预期

不存在的 shellPath → 明确错误；容器 healthy；默认 bash 仍可建终端

## 实际

explicit=true healthy=true recovered=true

## 备注

- 脚本：artifacts/rc5/E1/TERM/term-014.mjs（本 runner 现场执行）

## 证据附件

- `cmd.log`

## 执行命令

```
$ node artifacts/rc5/E1/TERM/term-014.mjs  # EXIT=0
```
