# E3-TASKS-SURFACE — （lane 本地）tasks 设置/角色面 live 契约

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P1
- 结论：**PASS**
- 时间：2026-11-20T01:46:17.058Z → 2026-11-20T01:46:17.151Z

## 预期（51/54 原文口径）

settings/session-roles 可读；no-op 保存 changed=false；非法块 400

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | admin 登录 200 | status=200 |
| PASS | settings 读面 200 且含 6 块修订 | {"pause":2,"policy":0,"eval":0,"executor":0,"budget":0,"gates":0} |
| PASS | health/stats 载荷在场 | {"health":{"state":"ready","detail":"realm Mr.Ma 就绪","at":"2026-11-20T01:46:17.139Z","components":{"tasks":{"state":"ready","detail":"realm Mr.Ma 就绪(pass 2000ms)","at":"2026-11-20T01:44:33.929Z"},"reply":{"state":"ready","detail":"Nothing waiting","at":"2026-11-20T01:44:33.926Z"},"assessment":{"stat |
| PASS | no-op 保存 200 且 changed=false | {"ok":true,"saved":true,"changed":false,"revision":2,"policyVersion":"f8c053aea3997ba0e4045d9a7acc1cb2","settings":{"paused":false,"sources":{},"policy":{"rules":[],"sources":{}},"eval":{"mode":"obser |
| PASS | session-roles 200 且 masterId 在场 | {"ok":true,"masterId":"orchestrator-Mr.Ma","masterTitle":"eterna-tasks orchestrator","workerSessionIds":[]} |
| PASS | 非法块名被 400 拒绝 | status=400 |

## 命令原文（完整见 cmd.log）

- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `GET /access/api/tasks/settings` → exit=200
- `POST /access/api/tasks/settings` → exit=200（no-op 保存（资料类合并保存，值不变））
- `GET /access/api/tasks/session-roles` → exit=200
- `POST /access/api/tasks/settings` → exit=400（非法块名负向）

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
