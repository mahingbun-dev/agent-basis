# RC5-MCPS-002 · 重启容器后 server 仍在且连接成功

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T01:41:27.061Z / 2026-11-20T01:41:33.712Z

## 预期

配置跨重启保留；`mcpManager/probe` 连接成功并列出工具

## 实际

health=healthy 配置保留=true probe.ok=true tools=echo

## 备注

- 重启为本 lane 容器自身（独立数据根），不涉及生产/其它 lane 容器

## 证据附件

- `cmd.log`

## 执行命令

```
$ docker restart rc5-e1suite  # EXIT=0
$ POST /api/mcpManager/probe {"name":"e1http"}（重启后）  # EXIT=200
```
