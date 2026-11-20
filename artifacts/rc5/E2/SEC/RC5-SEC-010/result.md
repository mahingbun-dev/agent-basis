# RC5-SEC-010 · 旧会话/记忆/提示词升级后可用且可继续对话

- 套件：SEC
- 结论：**PASS**
- 开始/结束：2026-11-20T06:59:02.601Z / 2026-11-20T06:59:14.290Z

## 预期

旧数据（0.1.51 卷副本）升级到 rc.5 终版后：内容完整、可继续对话

## 实际

events=22 userText=「只回复两个字：收到」 assistant=「收到」 access={"users":2,"sessions":145,"workspaces":3} memory=12/15 prompt=155 health=healthy fatal=0 open=true continue=true fakeOnly=true

## 备注

- 独立 lane：项目 rc5-sec10 / 容器 eterna-rc5-sec10 / 端口 3232（未触碰生产、E1/E2/E3、浸泡容器）
- 数据源=/Users/sunny/eterna-data/test-rc5/p6b-e5b（DATA-010 旧卷副本，0.1.51 启动过，rc.5 从未启动）；复制到 /Users/sunny/eterna-data/test-rc5/p6b-sec10 后升级，源副本不动
- 镜像=eterna-agent:rc5-test（终版 sha256:22fe8acb436f…）；登录用户=旧数据管理员 Mr.Ma
- 旧卷 Mr.Ma 口令不在任何存量配置中：升级前仅在副本内重置 password_hash（账号/角色/归属/会话/记忆/提示词不动）
- 续聊前把会话模型切到本机确定性假模型（session/selectModel），证明不依赖真实模型/不出网
- 假模型日志 /Users/sunny/code/agent-basis-rc5/artifacts/rc5/E2/SEC/tmp/fake-llm-sec010.jsonl（只记工具名/模型/消息数，不记 prompt 正文与凭据）；FAKE_LLM_API_KEY 为本地占位（compose.sec10.override.yml）

## 证据附件

- `cmd.log`

## 执行命令

```
$ rsync -aH /Users/sunny/eterna-data/test-rc5/p6b-e5b/ /Users/sunny/eterna-data/test-rc5/p6b-sec10/（旧卷副本 → 独立 sec10 根）  # EXIT=0
$ sqlite: UPDATE users SET password_hash（Mr.Ma，仅口令）  # EXIT=0
$ zstd -dc …/session-2ef15ce5-f5f5-48d8-83ae-2b22da492720/session.v4.jsonl.zstd | wc -l  # EXIT=0
$ sqlite: access users/sessions/workspaces  # EXIT=0
$ sqlite: memory_entity/domain_registry + content sha256  # EXIT=0
$ storages/eterna_prompt* 文件数 + 清单 sha256  # EXIT=0
$ 写 /Users/sunny/eterna-data/test-rc5/.env.sec10（0600；沿用 p6b-a 凭据，仅改实例/端口/数据根）  # EXIT=0
$ docker compose -p rc5-sec10 --env-file /Users/sunny/eterna-data/test-rc5/.env.sec10 -f /Users/sunny/code/agent-basis-rc5/docker-compose.yml -f /Users/sunny/code/agent-basis-rc5/artifacts/rc5/E2/SEC/compose.sec10.override.yml up -d --no-build eterna-agent  # EXIT=0
$ docker inspect health/image  # EXIT=0
$ docker logs（扫描 FATAL）  # EXIT=0
$ 管理员登录（旧数据用户 Mr.Ma）  # EXIT=200
$ POST /api/session/state（旧会话）  # EXIT=200
$ POST /api/session/wait {cursor:0}  # EXIT=200
$ POST /api/session/page（旧会话历史）  # EXIT=200
$ 升级后 sqlite: access 计数  # EXIT=0
$ 升级后 memory 计数/摘要哈希  # EXIT=0
$ 升级后 storages 提示词文件数/哈希  # EXIT=0
$ PORT=4607 FAKE_LLM_LOG=… node fake-llm-server.mjs  # EXIT=0
$ settings fake provider + agent-default-model + session/selectModel  # EXIT=200
$ POST /api/session/prompt（旧会话续聊，假模型）  # EXIT=200
$ 续聊收尾（session/state）  # EXIT=200
$ 假模型日志（续聊请求数/模型）  # EXIT=0
```
