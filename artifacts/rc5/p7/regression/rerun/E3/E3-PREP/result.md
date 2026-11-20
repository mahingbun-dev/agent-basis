# E3-PREP — E3 super 独立测试容器（项目/端口/数据根/镜像）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**FAIL**
- 时间：2026-11-20T01:45:06.480Z → 2026-11-20T01:45:06.699Z

## 预期（51/54 原文口径）

rc5-test-e3 / eterna-rc5-e3 / 3109 / $HOME/eterna-data/test-rc5/e3 / eterna-agent:rc5-test；生产容器不动

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | E3 容器存在且 running | running |
| PASS | E3 healthcheck healthy | healthy |
| PASS | 独立 compose 项目名 rc5-test-e3 | rc5-test-e3 |
| PASS | 容器名 eterna-rc5-e3 | /eterna-rc5-e3 |
| PASS | 镜像 tag eterna-agent:rc5-test | eterna-agent:rc5-test |
| PASS | 容器运行镜像 = 当前 eterna-agent:rc5-test 标签镜像（无 tag 漂移） | container=sha256:48782afaf8ba… tag=sha256:48782afaf8ba… created=2026-11-20T01:14:31.888254844Z |
| PASS | 端口 3109->8080（非生产 3210） | 3109->8080/tcp,9312->9310/tcp |
| PASS | relay 9312->9310（非生产 9310） | 3109->8080/tcp,9312->9310/tcp |
| PASS | 数据根 bind = $HOME/eterna-data/test-rc5/e3 | /Users/sunny/eterna-data/test-rc5/e3 -> /data (bind); /Users/sunny/code/agent-basis-rc5/docker/profile/cordis.patch.yml.template -> /repo/docker/profile/cordis.patch.yml.template (bind); /Users/sunny/code/agent-basis-rc5/docker/profile/cordis.super.patch.yml.template -> /repo/docker/profile/cordis.super.patch.yml.template (bind) |
| PASS | 数据根与生产根不相交 | /Users/sunny/eterna-data/test-rc5/e3 |
| PASS | ETERNA_FORM=super | super |
| PASS | DSH_HOME=/data 且 DSH_AGENTS_HOME=/data/agents | /data//data/agents |
| PASS | compose config exit 0 | exit=0 |
| PASS | compose 项目 name=rc5-test-e3 | rc5-test-e3 |
| PASS | compose container_name=eterna-rc5-e3 | eterna-rc5-e3 |
| PASS | compose 发布端口 3109/9312 | [{"mode":"ingress","target":8080,"published":"3109","protocol":"tcp"},{"mode":"ingress","target":9310,"published":"9312","protocol":"tcp"}] |
| PASS | compose /data 源 = E3 数据根 | /Users/sunny/eterna-data/test-rc5/e3 |
| PASS | 测试镜像 eterna-agent:rc5-test 存在 | sha256:48782afaf8ba6 |
| FAIL | 生产容器未重启/未换容器（ID+StartedAt+RestartCount 与基线一致） | before=[] now=[ID=492c35a4d450fddd1e65c993e4237e14fb497499e9fb077095dec796786fae7c StartedAt=2026-11-19T17:21:06.582265918Z RestartCount=0 Image=eterna-agent:0.1.51] |

## 命令原文（完整见 cmd.log）

- `docker inspect eterna-rc5-e3 --format {{json .}}` → exit=0（E3 容器 inspect（仅取白名单字段））
- `docker image inspect eterna-agent:rc5-test --format {{json .}}` → exit=0（测试镜像 inspect（只取 Id/Created））
- `docker compose -p rc5-test-e3 --env-file /Users/sunny/eterna-data/test-rc5/.env.e3 -f /Users/sunny/code/agent-basis-rc5/docker-compose.yml config --format json` → exit=0（compose config（--format json，只取服务/端口/卷字段））
- `docker image inspect eterna-agent:rc5-test --format {{.Id}}` → exit=0（测试镜像存在性）
- `docker inspect eterna-agent --format ID={{.Id}} StartedAt={{.State.StartedAt}} RestartCount={{.RestartCount}} Image={{.Config.Image}}` → exit=0（生产容器只读基线）

## 备注

- 容器 /eterna-rc5-e3 project=rc5-test-e3 image=eterna-agent:rc5-test health=healthy
- 镜像 eterna-agent:rc5-test created=2026-11-20T01:14:31.888254844Z（container 于 2026-11-20T01:44:28.479881258Z 由 prepare e3 up 重建并沿用 E3 数据根）
- 镜像无 commit/OBS 标签（Config.Labels=null）：sha 99d8e85b509b 只能按镜像 id 追溯，不能等同于 worktree commit 02f4857 的确定性构建。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
