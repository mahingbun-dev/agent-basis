# RC5-TERM-008 · 读取“用户终端列表”类能力不可见/不可调（不暴露宿主终端）

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:53.983Z / 2026-11-20T07:05:53.993Z

## 预期

伪造 sessionId 不返回宿主终端（拒绝或空数组）；readUserTerminals=false

## 实际

A=remote-access/denied B=remote-access/denied readUserTerminals=false:true

## 备注

- terminal/list 只按 sessionId 取该会话的 retained 终端；伪造 id 的 lookup 解析失败即 deny，没有“枚举宿主用户终端”的入参面

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/terminal/list（A，伪造不存在的 sessionId）  # EXIT=200
$ POST /api/terminal/list（B，伪造不存在的 sessionId）  # EXIT=200
```
