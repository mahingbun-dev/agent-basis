# RC5-MCPP-017 · 慢 HTTP 工具 60s 调用超时（工具级错误，不炸会话）

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T05:52:15.937Z / 2026-11-20T05:53:17.879Z

## 预期

工具在清单中；调用约 60s 返回超时错误；回合正常收尾；夹具 90s 响应不抵达

## 实际

dispatched=true elapsedMs=60412 timeoutText=Error: Request timed out turn=ok

## 备注

- lane=rc5-e2suite（独立测试容器，未触碰生产）
- 默认 toolCallTimeoutMs=60000（dsh-mcp-client DEFAULT_TOOL_CALL_TIMEOUT_MS）；夹具故意等 90s
- 确定性假模型只决定 tool_call；工具执行/超时/结果回传全部走产品代码

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/catalog（读取白名单）  # EXIT=200
$ node tests/fixtures/mcp-slow-http-server.mjs --port 18122 --host 0.0.0.0  # EXIT=0
$ docker exec rc5-e2suite node -e fetch(http://host.docker.internal:18122/health)  # EXIT=0
$ POST /api/mcp-personal/upsert {name:slow,url:http://host.docker.internal:18122/mcp}（B）  # EXIT=200
$ POST /api/session/create（B，慢工具会话）  # EXIT=200
$ POST /api/session/prompt（假模型 @@CALL 慢工具）  # EXIT=200
$ 读取 fake-llm.jsonl（tools 清单/工具结果）  # EXIT=0
$ POST /api/session/wait（回合记录）  # EXIT=200
```
