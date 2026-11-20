# RC5-MCPS-009 · 写入非法 transport 明确报错且不破坏配置

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:00.908Z / 2026-11-20T07:03:01.002Z

## 预期

settings/update 被 schema 拒绝；渲染 patch 的既有 servers 不变

## 实际

explicit=true intact=true

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/settings/update {"ns":"mcp-manager"}（transport=carrier-pigeon）  # EXIT=200
```
