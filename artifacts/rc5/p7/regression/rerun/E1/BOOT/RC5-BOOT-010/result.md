# RC5-BOOT-010 · 损坏 package.json 的 profile 副本启动

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T01:43:11.461Z / 2026-11-20T01:43:13.796Z

## 预期

旧文件保留；`.upgrade-profile-bundles-backup.json`（0600）留痕；日志明确告警；boot 不静默吞错

## 实际

原文件保留=true 留痕=true(600) 告警=true 脚本错误=true 容器健康=unhealthy HTTP=0

## 备注

- 字段级实证：损坏 manifest 无法被上游装载，容器最终健康状态如实记录；本用例判据=失败可见且旧文件/留痕不丢

## 证据附件

- `boot-corrupt.log`
- `cmd.log`

## 执行命令

```
$ docker run -d … rc5-e1suite-boot10（package.json 损坏副本）  # EXIT=0
```
