# RC5-BOOT-009 · 已 opt-out 的默认 bundle 不回加

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:32.644Z / 2026-11-20T07:02:39.447Z

## 预期

从清单删除 terminal bundle 后重启：不再追加；marker 仍记该项（用户关闭语义）

## 实际

清单漂移=无 marker含terminal=true health=healthy

## 证据附件

- `boot-optout.log`
- `cmd.log`

## 执行命令

```
$ docker run -d … rc5-e1suite-boot8（用户 opt-out 后再启）  # EXIT=0
```
