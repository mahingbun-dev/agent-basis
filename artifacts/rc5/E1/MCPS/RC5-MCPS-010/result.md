# RC5-MCPS-010 · 系统 MCP 启动失败时会话仍可用

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:01.002Z / 2026-11-20T07:03:01.202Z

## 预期

坏 server probe 明确失败；session/create 与容器健康不受影响

## 实际

error_visible=true session_ok=true health=healthy

## 备注

- 清理：从渲染 patch 移除 badsrv 并重启 lane（settings 合并语义无删除键，直接改渲染文件后由 entrypoint 迁移保留 e1http）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/settings/update（加入启动会失败的 stdio server）  # EXIT=200
$ POST /api/session/create（坏 server 在册时）  # EXIT=200
$ POST /api/mcpManager/probe {"name":"badsrv"}  # EXIT=200
$ docker inspect rc5-e1suite（health）  # EXIT=0
```
