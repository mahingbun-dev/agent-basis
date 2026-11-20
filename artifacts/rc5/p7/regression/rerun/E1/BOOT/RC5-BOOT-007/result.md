# RC5-BOOT-007 · preset 全量替换后 rc.5 默认行无丢失

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T01:42:43.785Z / 2026-11-20T01:42:43.917Z

## 预期

`--dump-default-config` 的每个行 id 仍出现在 `--dump-config` 中

## 实际

默认行=0 组合行=265 丢失=0

## 备注

- 两 dump 均在同一容器内生成（同一镜像/同一 profile 层）

## 证据附件

- `dump-default.yml`
- `dump-config.yml`
- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite sh -c 'DSH_HOME=/data dsh --profile eterna-web --dump-config --dump-default-config > /tmp/dump-eterna-web-1795138963785.yml; echo EXIT=$?; wc -c < /tmp/dump-eterna-web-1795138963785.yml'  # EXIT=1
```
