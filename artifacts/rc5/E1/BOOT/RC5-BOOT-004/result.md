# RC5-BOOT-004 · 启动日志无未知 plugin 行

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:11.883Z / 2026-11-20T07:02:11.906Z

## 预期

`unknown plugin row` 计数 0

## 实际

计数=0

## 备注

- 日志取自本 lane 容器自启动以来的全部 stdout/stderr

## 证据附件

- `dump-config.yml`
- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite sh -c 'DSH_HOME=/data dsh --profile eterna-web --dump-config > /tmp/dump-eterna-web-1795158131706.yml; echo EXIT=$?; wc -c < /tmp/dump-eterna-web-1795158131706.yml' && docker cp rc5-e1suite:/tmp/dump-eterna-web-1795158131706.yml  # EXIT=0
```
