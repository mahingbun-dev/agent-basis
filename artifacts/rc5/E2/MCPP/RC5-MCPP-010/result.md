# RC5-MCPP-010 · 任意 HTTPS 地址（不可解析域名）校验通过、不被策略拦

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T07:04:43.870Z / 2026-11-20T07:04:51.060Z

## 预期

upsert 成功；probe 连接失败属网络层（白名单默认空）

## 实际

hostWhitelist=[] upsert=true/streamable-http probe={"ok":false,"toolCount":0,"error":"SdkError: Version negotiation probe failed: fetch failed, cause: TypeError: fetch failed, cause: getaddrinfo ENOTFOUND unreso…

## 备注

- 独立 lane：项目 rc5-mcpp10 / 容器 eterna-rc5-mcpp10 / 端口 3233（未触碰 E2 主 lane、E1/E3、浸泡容器与生产）
- 010 要求白名单为空（H16 已接受风险：任意 host/内网可达）；MCPP-011 在同一 E2 lane 用非空白名单验证收紧能力，两者互斥故分 lane
- 不可解析域名（.invalid）用于证明策略不做 DNS/连通性预检，不依赖外网
- 镜像=eterna-agent:rc5-test（sha256:22fe8acb436f…）

## 证据附件

- `cmd.log`

## 执行命令

```
$ 写 /Users/sunny/eterna-data/test-rc5/.env.mcpp10（0600；独立数据根 /Users/sunny/eterna-data/test-rc5/mcpp10；host 白名单为空）  # EXIT=0
$ docker compose -p rc5-mcpp10 --env-file /Users/sunny/eterna-data/test-rc5/.env.mcpp10 -f /Users/sunny/code/agent-basis-rc5/docker-compose.yml up -d --no-build eterna-agent  # EXIT=0
$ docker inspect health/image  # EXIT=0
$ 管理员登录（rc5admin）  # EXIT=200
$ POST /api/mcp-personal/catalog（空白名单）  # EXIT=200
$ POST /api/mcp-personal/upsert {url:https://unresolvable.invalid/mcp}  # EXIT=200
$ POST /api/mcp-personal/probe（同一条目）  # EXIT=200
$ POST /api/mcp-personal/delete（清理）  # EXIT=200
```
