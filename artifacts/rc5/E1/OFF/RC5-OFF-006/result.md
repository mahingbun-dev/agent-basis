# RC5-OFF-006 · 输出目录 24h/512MB 清理与备份排除

- 套件：OFF
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:24.099Z / 2026-11-20T07:03:24.100Z

## 预期

24h/512MB 清理生效；备份不含 outputs

## 实际

3 天前的 store 生成目录在容器重启后被 sweep 删除，当日目录保留；office-kit 默认 outputRetentionMs=24h、maxOutputStoreBytes=512MiB；backup-data.sh:81 显式排除 office-kit/outputs

## 备注

- 清理以目录 mtime 判定，仅扫 session-<24hex>/<uuid-v4> 形态（dsh-office-kit/lib/index.js:191-196/364-380）

## 证据附件

- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite node … 创建 session-aaaa…/<uuid-v4>/out.pdf（mtime 回拨 3 天）与 session-bbbb…/<uuid-v4>/（新鲜）；docker restart rc5-e1suite  # EXIT=0
$ docker exec rc5-e1suite ls -d /data/office-kit/outputs/session-aaaa… 与 session-bbbb…  # EXIT=2
$ grep -n "outputRetentionMs\|maxOutputStoreBytes" dsh-office-kit/lib/index.js；grep -n office-kit/outputs deploy/backup-data.sh  # EXIT=0
```
