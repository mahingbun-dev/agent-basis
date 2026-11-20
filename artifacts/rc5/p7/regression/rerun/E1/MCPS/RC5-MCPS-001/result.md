# RC5-MCPS-001 · 管理员新增系统层 HTTP MCP server

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T01:41:26.844Z / 2026-11-20T01:41:27.061Z

## 预期

保存成功；rendered profile 的 `mcp-manager.config.servers` 落盘该 server；describe 立即反映

## 实际

write=true patch落盘=true describe.servers=e1http

## 备注

- server 形态=streamable-http（rc.5 接受值集合 {stdio, streamable-http}；`http` 被 schema 拒绝）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/settings/update {"request":{"ns":"mcp-manager","patch":{servers:{e1http:{transport:streamable-http,url:http://host.docker.internal:8766/mcp}}}}  # EXIT=200
```
