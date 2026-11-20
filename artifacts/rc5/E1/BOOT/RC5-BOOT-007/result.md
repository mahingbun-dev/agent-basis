# RC5-BOOT-007 · preset 全量替换后 rc.5 默认行无丢失

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:11.910Z / 2026-11-20T07:02:12.133Z

## 预期

`--dump-default-config` 的每个行 id 仍出现在 `--dump-config` 中

## 实际

默认行=229 组合行=266 丢失=0

## 备注

- 两 dump 均在同一容器内生成（同一镜像/同一 profile 层）

## 证据附件

- `dump-default.yml`
- `dump-config.yml`
- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite sh -c 'DSH_HOME=/data dsh --profile eterna-web --dump-default-config > /tmp/dump-eterna-web-1795158131910.yml; echo EXIT=$?; wc -c < /tmp/dump-eterna-web-1795158131910.yml' && docker cp rc5-e1suite:/tmp/dump-eterna-web-1795158131910.yml  # EXIT=0
```
