# RC5-BOOT-011 — `DSH_AGENTS_HOME=/data/agents` + 用户级 skills（DEFERRED to W5，**发现 P0 缺口**）

- 方式：S（E1 容器）｜结论：**DEFERRED to W5（不标绿）**
- 附带发现：**`DSH_AGENTS_HOME` 在产品容器工件里根本没有落地（P0，已写 leftover）。**

## 事实（本会话读取）

设计口径要求容器内 `DSH_AGENTS_HOME=/data/agents`：

- `docs/design/48-容器数据持久化目录改造方案.md` §6.2（:386-393）：
  `environment: DSH_AGENTS_HOME: /data/agents`，并建 `${ROOT}/agents`；
- `docs/design/54-...workflow.md:117`：「容器内不变: DSH_HOME=/data, DSH_AGENTS_HOME=/data/agents」。

但实际工件：

| 文件 | 检索结果 |
|---|---|
| `Dockerfile:75` | 只有 `ENV DSH_HOME=/data`，无 `DSH_AGENTS_HOME` |
| `docker/entrypoint.sh` | `grep -n "DSH_AGENTS_HOME\|/data/agents"` → 无命中 |
| `docker-compose.yml` / `docker-compose.super.yml` | environment 块无 `DSH_AGENTS_HOME` |

上游语义（`node_modules/.pnpm/@deepseek-ai+dsh-skill-filesystem@0.2.2-rc.5*`）：
`agentsHome` 缺省 `$DSH_AGENTS_HOME` 或 `~/.agents`（`src/index.ts:55-56`, `:167`），
user skills 根 = `<agentsHome>/skills`（`:264`）。未设该 env 时容器内落到镜像用户
home 的 `.agents`，`/data/agents` 不会被创建/使用 → 「写入即落容器层」，rc.5 用户级
能力不成立。

## 为什么本地双 boot 不能代替

本用例要求 E1 容器内 `echo $DSH_AGENTS_HOME` 与写用户 skills；本地 verify 直接跑
dsh CLI，不经过镜像 env/volume，无法证明容器口径。

## W5 建议执行

1. 先补落地（产品文件，不属 T11 可改范围）：Dockerfile ENV 或 compose
   `environment: DSH_AGENTS_HOME: /data/agents`，entrypoint init `mkdir -p /data/agents`；
2. 容器内 `echo $DSH_AGENTS_HOME` = `/data/agents`；
3. 写 `/data/agents/skills/<probe>/SKILL.md`，新会话触发该 skill；
4. 重启容器后 skill 仍在（卷持久化）。

## 证据

- 本报告内文件/行号引用
- `docs/design/48-容器数据持久化目录改造方案.md:386-393`
- `docs/dev/TODO.md:344`（同一条未勾项）