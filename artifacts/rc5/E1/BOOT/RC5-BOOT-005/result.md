# RC5-BOOT-005 · 已删除行不再出现

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:11.907Z / 2026-11-20T07:02:11.907Z

## 预期

`account-controller`、`office-to-pdf` 不在组合后的 profile 树

## 实际

命中=无

## 备注

- 判定面=`dsh --profile eterna-web --dump-config`（bundle 层 + 用户 patch 层全量合成）

## 证据附件

- `dump-config.yml`
- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite sh -c 'DSH_HOME=/data dsh --profile eterna-web --dump-config > /tmp/dump-eterna-web-1795158131706.yml; echo EXIT=$?; wc -c < /tmp/dump-eterna-web-1795158131706.yml' && docker cp rc5-e1suite:/tmp/dump-eterna-web-1795158131706.yml  # EXIT=0
```
