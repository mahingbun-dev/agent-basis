# RC5-MCPS-007 · 管理员 watch 连接状态

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:00.700Z / 2026-11-20T07:03:00.703Z

## 预期

流可用；首帧带 server 清单/连接状态（含 e1http）

## 实际

type=item has=true

## 备注

- 同轮 005 已证普通用户同端点 denied（权限面收窄到 admin）

## 证据附件

- `cmd.log`

## 执行命令

```
$ WS /api/remote.mux open {endpoint:"mcpManager/watch"}（A 管理员）  # EXIT=0
```
