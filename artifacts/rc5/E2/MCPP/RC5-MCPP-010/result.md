# RC5-MCPP-010 · 任意 HTTPS 地址（不可解析域名）校验通过、不被策略拦

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-19T23:53:24.865Z / 2026-11-19T23:53:24.952Z

## 预期

upsert 成功；probe 连接失败属网络层（白名单默认空）

## 实际

upsert=true/streamable-http；probe={"ok":false,"toolCount":0,"error":"SdkError: Version negotiation probe failed: fetch failed, cause: TypeError: fetch fai…

## 备注

- 不可解析域名用于证明“不做 DNS/连通性预检”，不依赖外网

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/upsert {name:https-unresolvable,url:https://unresolvable.invalid/mcp}（B）  # EXIT=200
$ POST /api/mcp-personal/probe（同一行）  # EXIT=200
```
