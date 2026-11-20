# RC5-MCPP-020 · B 构造 mcp__p<A_uid>_* 调用：同用户子代理放行、跨用户 deny

- 套件：LLM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:06:01.139Z / 2026-11-20T07:06:04.230Z

## 预期

跨用户不可见/被拒且无内容；同用户子代理可调用自己的工具

## 实际

cross_absent=true child_sees=true

## 备注

- A uid=1 / B uid=2
- 跨用户判定以请求 tools 清单缺席 + 强制调用被拒双重取证

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/upsert（A/B 各一条 echo）  # EXIT=200
$ POST /api/session/prompt（B 构造 mcp__p<A>_*）  # EXIT=200
$ POST /api/session/prompt（B 的子代理调用 mcp__p<B>_*）  # EXIT=200
```
