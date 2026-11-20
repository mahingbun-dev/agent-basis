# RC5-BOOT-002 — E3 super 容器起：healthy + super 路由可访问

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-20T01:45:06.752Z → 2026-11-20T01:45:07.512Z

## 预期（51/54 原文口径）

healthy；super 路由可访问（/login、/、/access/api/tasks/*、/workbench/api/stream），22 行 @eterna 挂载 active

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | super 容器 healthy | healthy |
| PASS | 最近一次 healthcheck ExitCode=0 | {"exit":0} |
| PASS | ETERNA_FORM=super 且 profile 目录=eterna-super | form=super |
| PASS | 容器内 dsh --version = 0.2.2-rc.5 | 0.2.2-rc.5 |
| PASS | GET /login 200 且返回中文登录页 | status=200 bytes=21095 |
| PASS | admin 登录 200 | status=200 |
| PASS | GET / 200 且注入 __DSH_BOOT__ 花名册 | status=200 bytes=47093 |
| PASS | GET /access/api/tasks/settings 200 ok（super 专属路由） | {"ok":true,"realm":"Mr.Ma","masterId":"orchestrator-Mr.Ma","masterTitle":"eterna-tasks orchestrator","paused":false,"policyVersion":"f8c053aea3997ba0e4045d9a7acc1cb2","settings":{"paused":false,"sources":{},"policy":{"rules":[],"sources":{}},"eval":{"mode":"observe","timeoutSeconds":120,"model":null |
| PASS | 任务设置含 realm/masterId/health/stats | {"realm":"Mr.Ma","masterId":"orchestrator-Mr.Ma","health":"object","stats":"object"} |
| PASS | GET /access/api/tasks/session-roles 200 ok | {"ok":true,"masterId":"orchestrator-Mr.Ma","masterTitle":"eterna-tasks orchestrator","workerSessionIds":[]} |
| PASS | GET /workbench/api/stream 200 text/event-stream | 200 text/event-stream; charset=utf-8 |
| PASS | 工作台首帧为 snapshot | {"kind":"snapshot","seq":1,"snapshot":{"tickets":[],"conflict":{"attach":{"count":0,"note":"同线程候选挂接 · 7 日（routed 决策）"},"duplicate":{"percent":0,"thresholdPercent":5,"note":"幂等查重 · 计数接入后展示","unavailabl |
| PASS | host entries=235（rc.5 基线） | entries=235 |
| PASS | super 模板 22 行 @eterna insert 全部 enabled+active | eterna-governance, eterna-audit, eterna-egress, eterna-memory, eterna-knowledge, eterna-llm-doctor, eterna-brand, eterna-access, eterna-prompt-studio, eterna-usage-stats, eterna-panel, eterna-workbench, eterna-attachments, eterna-compaction-client, eterna-compaction-admin, eterna-memory-client, eterna-memory-admin, eterna-tasks, eterna-channels, eterna-interact, eterna-toolkit, eterna-tasks-access |

## 命令原文（完整见 cmd.log）

- `docker inspect eterna-rc5-e3 --format {{json .}}` → exit=0（E3 容器 inspect（仅取白名单字段））
- `docker exec eterna-rc5-e3 dsh --version` → exit=0（容器内 dsh 版本）
- `GET /login` → exit=200（super 登录页）
- `docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)` → exit=0（boot token 不入证据）
- `GET /connect + GET /?token=… (dsh session bootstrap)` → exit=200（token 已脱敏）
- `POST /login (admin from 0600 accounts file)` → exit=200
- `GET /` → exit=200（super 应用壳（带会话））
- `GET /access/api/tasks/settings` → exit=200（super 专属任务设置读面）
- `GET /access/api/tasks/session-roles` → exit=200（super 专属会话角色读面）
- `GET /workbench/api/stream` → exit=200（SSE 首帧）
- `POST /api/pluginInventory/list` → exit=200
- `read docker/profile/cordis.super.patch.yml.template` → exit=0

## 备注

- 容器 /eterna-rc5-e3 project=rc5-test-e3 image=eterna-agent:rc5-test health=healthy

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
