# RC5-MCPS-005 · 普通用户 watch 系统层 MCP 流被拒

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-19T22:50:49.757Z / 2026-11-19T22:50:49.762Z

## 预期

流 open 被 remote-access 拒绝（no-allow），不泄漏 server 清单/连接状态

## 实际

message.type=error code=remote-access/denied

## 备注

- WS mux 使用 cookie（eterna_session + dsh-auth）打开；判定面=open 后的首个流帧

## 证据附件

- `cmd.log`

## 执行命令

```
$ WS /api/remote.mux open {endpoint:"mcpManager/watch"}（B 普通用户）  # EXIT=0
```
