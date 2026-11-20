# RC5-BOOT-011 · DSH_AGENTS_HOME 落 /data/agents 且用户级技能可写

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-19T22:44:24.778Z / 2026-11-19T22:44:25.018Z

## 预期

容器内 `DSH_AGENTS_HOME=/data/agents`；`resolveAgentsHome` 同值；用户 skills 目录可写、文件对 dsh 进程可见

## 实际

env=/data/agents resolver=/data/agents skillFile=present

## 备注

- 技能“生效”的 agent 级消费（进入某会话的 skills 快照）需真实模型回合，E1 未执行；本用例覆盖路径解析 + 文件可见性 + 上游 provider 读取 agents home 的代码位

## 证据附件

- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite printenv DSH_AGENTS_HOME  # EXIT=0
$ docker exec … node -e "require(dsh-home-paths).resolveAgentsHome(undefined, process.env)"  # EXIT=0
$ docker exec … test -f /data/agents/skills/e1suite-probe/SKILL.md  # EXIT=0
$ docker exec … grep agentsHome dsh-skill-filesystem/lib/index.js  # EXIT=0
```
