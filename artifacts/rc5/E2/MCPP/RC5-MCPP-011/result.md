# RC5-MCPP-011 · personalHttpHosts 白名单：精确 host / *.suffix / 非子域 / 端口

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T05:52:07.647Z / 2026-11-20T05:52:07.716Z

## 预期

a.example 与 *.suffix.test 的子域放行；b.example、suffix.test、未列端口被拒；被拒行不落库

## 实际

https://b.example/mcp=>DENY；https://a.example/mcp=>ALLOW；https://svc.suffix.test/mcp=>ALLOW；https://suffix.test/mcp=>DENY；https://a.example:8443/mcp=>ALLOW；https://b.example:8443/mcp=>ALLOW；https://b.example:9443/mcp=>DENY

## 备注

- lane=rc5-e2suite（独立测试容器，未触碰生产）
- 本用例与 MCPP-010（白名单为空=全放行）互证：同一产品代码在两种配置下行为相反
- 容器环境变量：ETERNA_MCP_PERSONAL_HTTP_HOSTS=a.example,*.suffix.test,host.docker.internal

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/catalog（B，读取生效白名单）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:wh-b,url:https://b.example/mcp}（期望 deny）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:wh-a,url:https://a.example/mcp}（期望 allow）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:wh-wild,url:https://svc.suffix.test/mcp}（期望 allow）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:wh-apex,url:https://suffix.test/mcp}（期望 deny）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:wh-anyport,url:https://a.example:8443/mcp}（期望 allow）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:wh-port-ok,url:https://b.example:8443/mcp}（期望 allow）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:wh-port-bad,url:https://b.example:9443/mcp}（期望 deny）  # EXIT=200
$ POST /api/mcp-personal/list（白名单尝试后）  # EXIT=200
$ POST /api/mcp-personal/delete（清理白名单用例行）  # EXIT=200
$ POST /api/mcp-personal/delete（清理白名单用例行）  # EXIT=200
$ POST /api/mcp-personal/delete（清理白名单用例行）  # EXIT=200
$ POST /api/mcp-personal/delete（清理白名单用例行）  # EXIT=200
```
