# RC5-MCPP-023 · 重启容器后个人配置仍在

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T01:38:55.037Z / 2026-11-20T01:39:01.684Z

## 预期

配置跨重启保留；新会话可用（本行验证持久化面）

## 实际

健康=healthy 重启前=["p2_persist-probe"] 重启后=["p2_persist-probe"]

## 备注

- 官方脚本该行报 before=4 after=0：脚本重启后用**仅 eterna_session** 的 cookie 调 mcp-personal/list，实测返回 401 → items 空；补 dsh-auth 后同一配置可读（本次受控复测 PASS）
- 未修改 scripts/verify-mcp-personal.mjs（非本 lane 可改文件）→ 记遗留项（测试脚手架 bug）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/upsert {name:persist-probe,stdio,catalogId:echo}（B）  # EXIT=200
$ POST /api/mcp-personal/list（重启前，dsh+eterna cookie）  # EXIT=200
$ docker restart --time 20 rc5-e2suite  # EXIT=0
$ docker inspect rc5-e2suite --format {{.State.Health.Status}}  # EXIT=0
$ POST /api/mcp-personal/list（重启后，完整 cookie）  # EXIT=200
$ POST /api/mcp-personal/delete（清理 persist-probe）  # EXIT=200
```
