# RC5-MCPP-022 · B 登出后 live 会话个人工具立即不可用（scope dispose）

- 套件：LLM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:06:04.260Z / 2026-11-20T07:06:06.496Z

## 预期

登出触发 disposeUser；同一 live 会话的下一回合 tools 清单已无个人工具，调用被拒

## 实际

round1=true logout=302 round2_absent=true

## 备注

- 会话 cookie 是无状态 bearer：登出=302+浏览器侧 Max-Age=0 清除，服务端不吊销 token；判定只走 live 会话工具面

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/upsert（B，登出前）  # EXIT=200
$ POST /api/session/prompt（第一回合：登出前调用）  # EXIT=200
$ 假模型日志：登出前 echo 回显  # EXIT=200
$ POST /logout（B 登出）  # EXIT=302
$ 假模型请求日志（登出后同一会话回合）  # EXIT=200
```
