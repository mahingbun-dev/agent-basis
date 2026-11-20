# RC5-MCPP-019 · 删除个人 server 后 live 会话工具当场消失

- 套件：LLM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:06:00.838Z / 2026-11-20T07:06:01.139Z

## 预期

同一 live 会话立即不可见/不可调；新会话亦无

## 实际

before=true after=true fresh=true

## 备注

- 工具名=mcp__p2_llm19__echo（uid=2）
- 删除经 mcp-personal/delete → disposeUser 摘除 scope（产品路径），非测试直接改注册表

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/upsert（B，stdio echo）  # EXIT=200
$ POST /api/mcp-personal/delete（B 删除自己的 server）  # EXIT=200
$ POST /api/session/prompt（删除前/后/新会话，同一工具名）  # EXIT=200
```
