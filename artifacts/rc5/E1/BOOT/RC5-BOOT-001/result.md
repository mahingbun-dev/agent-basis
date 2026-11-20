# RC5-BOOT-001 · E1 空数据根首启

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-19T22:43:38.645Z / 2026-11-19T22:43:45.543Z

## 预期

容器 healthy；日志无 ERR_/unhandled；空根无既有 profile/会话

## 实际

health=healthy http=302 日志错误行=0 空根前置=true

## 备注

- 首启耗时约 6s；空根=profiles:0 users.db:false sessions:0

## 证据附件

- `boot.log`
- `cmd.log`

## 执行命令

```
$ docker run … rc5-e1suite-fresh（独立空根 $HOME/eterna-data/test-20261120/fresh）  # EXIT=0
```
