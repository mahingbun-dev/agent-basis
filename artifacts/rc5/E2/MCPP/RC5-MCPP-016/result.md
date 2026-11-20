# RC5-MCPP-016 · 挂死 stdio 8s 启动预算：放弃该条、会话仍可建

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T05:52:07.716Z / 2026-11-20T05:52:15.936Z

## 预期

目录项 hung 启动挂死 → 8s 后放弃；session/create 不被阻塞；日志留预算超时；会话可用

## 实际

upsert=true session=true elapsedMs=8051 state=true/false log=true

## 备注

- lane=rc5-e2suite（独立测试容器，未触碰生产）
- hung 的 command/args 只存在于管理员目录 env（测试夹具），用户侧不能自填 stdio command（MCPP-005 覆盖）
- 8s 预算常量为 MCP_PERSONAL_STARTUP_TIMEOUT_MS=8000；实测耗时含会话装配开销

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/catalog（B）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:hung,stdio,catalogId:hung}（B）  # EXIT=200
$ POST /api/session/create（B；期望 8s 预算到点后返回）  # EXIT=200
$ POST /api/session/state（会话可用性）  # EXIT=200
$ docker logs --since 2026-11-20T05:52:06.842Z rc5-e2suite | grep mcp-personal（截取相关行）  # EXIT=0
$ POST /api/mcp-personal/delete（清理 hung）  # EXIT=200
```
