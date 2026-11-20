# 部署与服务迁移指南

> 本目录是 EternaAgent **部署配置的唯一权威存放点**：生产 env 模板（[env.production.example](env.production.example)）、
> 部署后验证脚本（[verify.sh](verify.sh)）、本指南。换机/迁移/重部署照此执行即可。
> 历史文档 [docs/docker-deploy.md](../docs/docker-deploy.md) 保留镜像内部结构与数据根细节说明。

## 1. 拓扑总览

```text
外网用户 ── https://<域名>:<端口> ──▶ DNS(AAAA 推荐) ──▶ NAS nginx(TLS 终结, 保留 Host, WS✓)
                                                            │ 反代
内网用户 ── http://<Mac 内网 IP>:3210 ──────────────────────▶ Mac Docker(3210→8080) ──▶ eterna-agent 容器
                                                                              ├─ eterna-access 门禁(登录/用户/插件)
                                                                              ├─ 租户守卫(/api unary 归属判定)
                                                                              └─ dsh web + 全插件(绑定宿主数据根持久化)
本机运维 ── stdio(无端口) ──────────────────────────────────▶ eterna-agent-acp(profiles:acp)
```

实测拓扑记录（2026-11-10）：公网入口为 `https://eternity-electricity.cn:3210`（DSM 反代）；
域名 A(v4 27.45.210.8) + AAAA 双栈并存，**v4 仅转发 443/8443**，v4:3210 未转发 → 浏览器
Happy Eyeballs 双栈竞速撞 v4 死路 = 间歇性「网络错误」。**修法 = DNSPod 删 A 记录（v6-only 推荐）**
或路由器补 v4:3210 转发。DNS 托管：DNSPod。

## 2. 配置的三层结构

| 层 | 位置 | 内容 | 入库？ |
| --- | --- | --- | --- |
| 模板 | `deploy/env.production.example` | 全变量+注释，非密值为当前部署实值 | ✅ |
| 机器真值 | `<repo>/.env`（gitignored） | 密钥真值（三家 API key / 管理员密码）+ `ETERNA_DATA_ROOT` | ❌ 永不 |
| 宿主数据根 | `${ETERNA_DATA_ROOT}/<实例>`（默认 `$HOME/eterna-data/super`） | 用户库/会话/审计/profile/工作区/agents | ❌（宿主目录，不纳入 git） |
| 注入 | compose `environment` → 容器 env → entrypoint 参数/patch 渲染 | 见 env 模板内注释 | ✅（变量名） |

全变量清单见 [env.production.example](env.production.example)（模型密钥 / 账号门禁 / 外网入口 / 数据根 / ACP，
每个变量含作用与缺省说明）。**迁移服务时，`.env` 与宿主数据根是唯一需要随身带的两样东西**。
`ETERNA_DATA_ROOT` 必须是**宿主绝对路径**，缺省 `$HOME/eterna-data`（与
`init-data-dirs.sh`/`backup-data.sh` 同口径）。2026-11-20 W4 门禁修复：compose 由
`${ETERNA_DATA_ROOT:?...}` 改为 `${ETERNA_DATA_ROOT:-$HOME/eterna-data}`——原硬必填会让
`docker compose config` 在无 `.env` 时直接失败（门禁三份 config 全红）。生产仍**建议显式设**
绝对路径；「`/data` 未挂载」仍由 entrypoint 的 mountpoint 预检 fail-closed 拒启。

## 3. 首次部署

```bash
cp deploy/env.production.example .env   # 填模型密钥 + 管理员密码 + ETERNA_DATA_ROOT(宿主绝对路径)
bash deploy/init-data-dirs.sh           # 建宿主数据根 0700 + 实例子目录(幂等)
docker compose build && docker compose up -d
bash deploy/verify.sh                   # 部署验证清单（§6）
```

首次启动自动完成：`/data` 挂载点预检（漏挂拒启）→ profile 渲染（patch 模板 + 插件裁剪 +
治理规则渲染 + rc.5 存量迁移）→ `@eterna/*` symlink → 管理员播种（用户表为空时）→ `dsh web` 监听。

`ETERNA_DATA_ROOT` 缺省 `$HOME/eterna-data`；`docker-compose.yml` 默认实例目录 `super`
（`ETERNA_INSTANCE` 可覆写）。测试实例（不同端口/不同根）见 50 §7.2：

```bash
ROOT="${ETERNA_DATA_ROOT:-$HOME/eterna-data}"
INSTANCE="test-$(date +%Y%m%d)"
bash deploy/init-data-dirs.sh "$INSTANCE"
ETERNA_CONTAINER_NAME=eterna-agent-test \
ETERNA_PORT=3108 ETERNA_RELAY_PORT=9318 \
ETERNA_INSTANCE="$INSTANCE" \
docker compose -p agent-basis-test -f docker-compose.yml up -d
```

治理规则：entrypoint 每次启动把 `docker/profile/governance.rules.yml` 渲染到容器
`/data/.eterna/governance.rules.yml`（= `$DSH_HOME/.eterna/`，governance-plugin 按
`process.cwd()` 读取；缺文件=空规则集= fail-closed 默认 ask；在 approval=never 的
「完全权限」档即静默全拒——2026-11-10 事故，规则集内工具名逐字对账见该文件头注）。
免重建改规则：在数据根放 `access/governance.rules.yml`（存在即优先），重启容器生效；
改后需跑 `packages/glue` 的 `governance-rules-fixture` 单测口径自行对账工具名。

## 4. 服务迁移（换机/换盘）与数据根

rc.5 起数据全部在**宿主 bind 目录** `${ETERNA_DATA_ROOT}/<实例>`（默认
`$HOME/eterna-data/super`；用户库/会话/审计/profile/工作区/agents）。容器内路径恒为 `/data`
（48 §5.2：只换宿主源，不换容器目标）。

### 4.1 换机（已在新形态上）

```bash
# ── 旧机：冷备 + 带走 .env ──
bash deploy/backup-data.sh              # 冷备(停→tar→起)，默认落 $ROOT/backups/<实例>-<ts>.tgz
# 保存 .env（含密钥；备份包含全部敏感面，视同密钥：传输/落盘加密）
# 同时带走备份 tgz

# ── 新机：仓库 checkout → 恢复 → 启动 ──
cp <迁移来的 .env> .env
bash deploy/init-data-dirs.sh
tar xzf <backup>.tgz -C "$ETERNA_DATA_ROOT/super"
docker compose up -d --build
bash deploy/verify.sh http://127.0.0.1:3210
```

### 4.2 从 named volume 迁移到宿主数据根（≤0.1.45 → rc.5；48 §7 runbook）

> 前提：`bash deploy/pre-restart-check.sh` 通过（无活动 turn）；迁移窗口内不接受新会话；
> **旧卷保留**，回滚即挂回。先在独立测试实例（不同端口 + 不同根，如 3108/3220）演练一遍，
> 并按 48 §4.5 做 macOS FUSE 的 SQLite 浸泡验证（D0：virtiofs 承载 WAL 有风险，先测再迁）。

```bash
ROOT="${ETERNA_DATA_ROOT:-$HOME/eterna-data}"
bash deploy/init-data-dirs.sh super

# 1) 冷备旧卷（保留回滚点）
mkdir -p "$ROOT/backups"
docker run --rm -v agent-basis_eterna-home:/src:ro -v "$ROOT/backups":/backup \
  alpine sh -c 'tar czf /backup/eterna-home-$(date +%Y%m%d-%H%M%S).tgz -C /src .'

# 2) 复制到宿主根（tar 保留符号链接；profiles/.pnpm-store/market 必须同盘，见 §9）
docker run --rm -v agent-basis_eterna-home:/src:ro -v "$ROOT/super":/dst \
  alpine sh -c 'cd /src && tar cf - . | (cd /dst && tar xf -)'

# 3) 停容器 → 改 compose(本仓已改为 bind + :? fail-closed) → 起容器
docker compose -p agent-basis stop eterna-agent
docker compose -p agent-basis up -d
docker logs --tail 200 eterna-agent        # 应看到 "/data mountpoint OK"

# 4) 验收
bash deploy/verify.sh http://127.0.0.1:3210
docker exec eterna-agent sh -lc 'node -e "
const {DatabaseSync}=require(\"node:sqlite\");
for (const p of [\"/data/access/users.db\",\"/data/.eterna/memory.sqlite3\",\"/data/.eterna/knowledge.sqlite3\"]) {
  const db=new DatabaseSync(p,{readOnly:true});
  console.log(p, db.prepare(\"PRAGMA integrity_check\").all());
}"'
```

人工项（48 §7.5）：登录 → 193 会话可见/可打开 → 设置三分区 → 已装插件仍在 → 提示词工坊
版本仍在 → 审计 jsonl 继续追加 → companion 中继可用 → 重启后状态不丢。

**回滚**：`docker compose -p agent-basis down`（不删卷）→ 恢复旧 compose（external + named volume）
→ `up -d`。旧卷未动，回滚即回到迁移前；稳定 ≥7 天后再考虑删卷。

### 4.3 备份

- 冷备：`bash deploy/backup-data.sh [实例]`（停 → tar czf → 起；排除 `office-kit/outputs`
  与 `.pnpm-store`；文件 0600、目录 0700）；
- 热备（可选，容忍 WAL 不一致）：`rsync -a --exclude=.pnpm-store --exclude=office-kit/outputs`，
  恢复后必须跑 `integrity_check`；
- 归档：备份包转第二块盘/NAS，不与生产同盘（48 §8.1）。

**换域名/端口**：同步改 `.env` 的 `ETERNA_PUBLIC_URL`、`ETERNA_TRUSTED_HOST`（含新端口）
与 `ETERNA_ACCESS_SECURE=1`（https 反代必设），重启即可——登录桥接与同源信任都以
`ETERNA_PUBLIC_URL` 声明为准，无需改代码。

## 5. 外网入口

DSM 反代规则要点（Control Panel → Login Portal → Advanced → Reverse Proxy）：

- Source: HTTPS `eternity-electricity.cn` `<端口>`；Destination: HTTP `<Mac IP>` `3210`
- **保留 Host 头**（同源闸按 Host 判定）；WebSocket ✓
- `.env` 三件套必须与之一致：`ETERNA_PUBLIC_URL=https://<域名>:<端口>` +
  `ETERNA_TRUSTED_HOST=<域名>:<端口>` + `ETERNA_ACCESS_SECURE=1`
- 插件同源闸信任面自动包含 `ETERNA_PUBLIC_URL` 声明根（isSameOrigin v2）——声明即免配
- 未登录/浏览器会话过期访问根路径由插件自动 302 到 `/login`（2026-11-17 起；此前依赖
  可选的 nginx `error_page 401` 配方，直连端口/其他反代形态会看到裸 401 文本页）

**chat-import 导入（rc.5；T44/IMP-010）**：归档接口
`/api/deepseek-chat-import/archive` 上传数 GB 的 NDJSON，反代必须放开两项，否则大包在
反代层就被 413/504 截断（与 512MiB 内存验收是两回事）：

```nginx
# DSM 反代规则「自定义配置 / Custom Header」或站点 server 块
client_max_body_size 512m;
proxy_read_timeout 1800s;    # 覆盖一次导入的时长(慢盘/大包)
proxy_send_timeout 1800s;
client_body_timeout 1800s;
```

其它页面不需要改；调小会直接让 chat-import 在大包上失败。条数与时长按 49 §5.6
「512MiB 驻留 + 流式逐行解析」口径由 IMP E2E 验证。

DNS：推荐 **v6-only**（AAAA）。实测记录：家宽 v4 入站被运营商上游封死（v4:3210/8443
外部探测全败，转发规则形同虚设）；保留 A 记录会让浏览器双栈竞速间歇撞死路（「网络错误」）。

## 6. 验证清单

自动化：`bash deploy/verify.sh [BASE_URL]` —— 12 项门禁（登录页/匿名拒绝/匿名根路径跳登录页/
管理员登录/角色回显/红线清单/无会话拒绝/错密码 401/治理规则活性/companion 中继/
分发包下载/指引页），全过退出 0。

人工：登录落地对话一轮（真模型）→ 设置弹窗三分区（账号/用户管理）→ 插件页「恒灵插件」
页签 → 审计 jsonl 增长。

## 7. 升级

**重建/重启前必查活动会话**（2026-11-13 事故：#68 重建时未查，正在运行的 turn 被
`disposed` 杀死）：

```bash
bash deploy/pre-restart-check.sh   # 近 120s 有会话写入则拒绝继续;确认可中断时 FORCE=1 放行
bash deploy/backup-data.sh         # 升级前冷备（48 §8.1：stop → tar → start）
git pull && docker compose build && docker compose up -d
bash deploy/verify.sh
```

数据根不删数据不丢（用户库/会话/审计/profile/工作区都在 `${ETERNA_DATA_ROOT}/<实例>`）；
`disabled-plugins.json` / `removed-plugins.json` 在每次启动时由 entrypoint 渲染管线应用。
`pre-restart-check.sh` 的容器名缺省取 `ETERNA_CONTAINER_NAME`（测试实例传参即可）。

rc.5 升级额外步骤（首启一次性）：entrypoint 的 rc.5 存量迁移自动补默认 bundle（H11/B18）、
把旧 patch 的 `mcp-manager.config.servers` 合并进新渲染（H9），失败只告警不阻塞启动，留痕在
`profiles/<name>/.upgrade-*-backup.json`（0600）。

## 8. 故障排查

| 症状 | 排查 |
| --- | --- |
| 启动即退：`FATAL /data 不是挂载点` | compose 卷行缺失/写错（48 §6.1 预检）：确认 `volumes` 里 `${ETERNA_DATA_ROOT}/<实例>:/data` 存在、`up` 不是用旧 compose 文件 |
| 数据落到了 `$HOME/eterna-data` 而预期是自定义根 | `.env` 未设 `ETERNA_DATA_ROOT`；compose 缺省即 `$HOME/eterna-data`（2026-11-20 起不再硬必填报错）。`cp deploy/env.production.example .env` 后补该行并迁移数据 |
| 启动日志 `DSH_AGENTS_HOME=... 不在 /data 下` | 覆写了 `DSH_AGENTS_HOME` 指向容器层——用户级 AGENTS/skills 会丢，改回 `/data/agents`（48 §6.2） |
| 外网登录「网络错误，请重试」 | 浏览器 fetch 层连接失败：①DNS 有 A 记录且 v4 未转发（删 A 走 v6）②DSM 反代未保留 Host/未开 WS ③容器重建窗口期 |
| 「跨源请求被拒绝」 | `.env` 三件套与实际访问的 scheme/域名/端口不一致：`ETERNA_PUBLIC_URL` 必须是浏览器地址栏的完整 https 根、`ETERNA_ACCESS_SECURE=1` |
| 登录后立刻被踢回登录页 | `ETERNA_ACCESS_SECRET` 被改动（轮换语义，全体会话下线） |
| 容器日志 `FAILED fiber` / eterna-access 未激活 | 门禁失效=裸奔窗口（R7）：查 users.db 可读性，重启容器 |
| 登录 429 | 限速窗口（每 IP+账号 5/min）未滑过 |
| chat-import 大包 413/504 | 反代未放开：`client_max_body_size 512m` + `proxy_read_timeout 1800s`（§5） |
| 工具调用全部被拒 `the user rejected tool "…"`（毫秒级失败，无人点过拒绝） | 治理规则集未渲染/被清空：governance 空规则 fail-closed ask × 当前档 approval=never 即全拒。查容器内 `/data/.eterna/governance.rules.yml` 是否存在、entrypoint 日志 `governance rules:` 行；修复见 §3 治理规则段 |

安全基线：`.env` 视为密钥（泄露即改管理员密码+换 `ETERNA_ACCESS_SECRET`）；容器日志中的
bootstrap token 视为敏感；公网入口建议反代层再加 basic auth 双保险。

## 9. 已知边界

- **数据根约束**（48 §3.1/§9）：宿主根 `0700`；`profiles` + `.pnpm-store` + `market` 必须同
  文件系统（硬链接）；**禁止网络文件系统**（SQLite WAL/flock 不可靠）；macOS Docker Desktop
  的 bind 是 virtiofs —— 容器内 `chmod/chown` 不落宿主，SQLite 承载能力按 48 §4.5 先做 24h
  浸泡 + `integrity_check` 再上生产（D0 门禁）；
- **ACP 信任边界**：`eterna-agent-acp` 只对本机运维开放，无端口、不接终端用户（§11）；
- **R12**：上游流端点（WS mux）不经守卫——工作区列表元数据对登录用户全局可见；数据面已隔离
- **失败开放**（R7）：access 插件挂载失败时 web 仍起（无门禁）——监控启动日志 FAILED fiber
- 插件启停/删除为**实例级**语义（共享 owner 会话模型约束）；per-user 插件可见性列上游需求项
- **会话 shell 与宿主同信任域**（2026-11-13 session-7e15e6ab 事故定论）：bash job 在容器内
  与 dsh 进程同权限运行，可读 companion-tokens.json（**全员**浏览器令牌）与 /data/relay-token
  ——结构上无法在不破坏 companion 注入/mcp-browser 的前提下隔离（令牌本就活在同一进程的
  配置与内存里）。现行约束=治理 deny 规则（`deny-credential-access`，bash/read/grep/glob/
  edit/write 命中 `relay-token`/`companion-tokens.json`/`:9310` 即拒）+ 提示词凭据/内服红线；
  这是**引导非强制**的边界，彻底隔离=沙箱容器化执行（P1-T3 之后路线）。令牌轮换入口：
  主令牌=删数据根上 `/data/relay-token` 后重启（扩展 options 同步换）；用户令牌=设置→账号→
  浏览器执行面「重置」

## 10. Companion 浏览器执行面（扩展分发 + 中继）

「用户的浏览器 = Agent 执行面」：用户在自己浏览器装 Eterna Companion 扩展（MV3，
chrome.debugger），Agent 经中继（relay）驱动用户真实浏览器页签，登录态天然复用。

**组件与端口**（容器内 entrypoint 自动拉起，无需手工起进程）：

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| relay | 容器内 `0.0.0.0:9310`（宿主映射 `9310`） | `/extension`=扩展 ws 腿（token 鉴权）；`/api/tools`=mcp-browser 后端（仅容器内 127.0.0.1 用）；`/companion/download.zip`+`/companion/guide`=用户引导 |
| mcp-browser | 生产 profile 模板 insert 块 | dsh-mcp-client stdio → `dist/mcp.mjs`；会话工具面出现 `mcp__browser__*` 三工具 |
| 扩展 zip | 镜像内 `/repo/packages/extension-companion/eterna-companion.zip` | 镜像构建期产出（Dockerfile build 阶段） |

**relay token（红线 9）**：`ETERNA_RELAY_TOKEN` env 优先；缺省首次启动自动生成
随机 token 落数据根 `/data/relay-token`（重启不变）。取值：

```bash
docker exec eterna-agent cat /data/relay-token
```

**用户侧安装（本机/局域网直连形态）**：

1. 浏览器开 `http://<本机IP>:9310/companion/guide` → 下载 zip 并解压；
2. `chrome://extensions` 开发者模式 → 加载已解压的扩展程序；
3. 扩展 options 里中继地址填 `ws://<本机IP>:9310/extension`、token 填上述值；
4. Eterna 会话说「打开 example.com」验证（扩展未连接时工具会报错并附指引页链接）。

**生产反代形态（外网用户）**：DSM 反代加一条规则——来源
`https://<域名>:<端口>/relay`（WebSocket 开启）→ 目标 `http://<本机IP>:9310`，
并在 `.env` 设：

```bash
ETERNA_RELAY_PUBLIC_URL=wss://<域名>:<端口>/relay/extension
```

guide 页与工具报错文案即按该地址展示；用户扩展 options 填同地址。

**已知边界**：relay 当前**单扩展连接位**（第二连接 409）——一个部署实例同一时刻
只服务一个用户浏览器；多人并发属 E4 后续（会话级 relay 编排）。`/api/tools`
仅容器内消费，反代不要转发除 `/relay`（→`/`）之外的路径。

**验证**：`deploy/verify.sh` 第 8-10 项（status/zip/guide 三端点）。

## 11. ACP stdio 服务（rc.5；T31/T43）

ACP 是**自动化客户端的受信 stdio 面**，不是 Web 功能（47 B17 / 49 §5.7）：

- 独立 profile `eterna-acp`：`docker/profile/package.acp.json` 的 `dsh.profile.bundles` 只有
  `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-acp-app]`；patch 只挂治理三行
  （eterna-governance / eterna-audit / eterna-egress），模型走 `mimo/mimo-v2.6-pro`；
- 独立 service `eterna-agent-acp`（`docker-compose.yml`，`profiles: ["acp"]`）：
  `stdin_open: true`、`tty: false`、**无 ports**，与 web 共享同一 `/data` 实例根；
- entrypoint 在 `ETERNA_FORM=acp` 时**把自身日志逐条写 stderr**（`log()`），
  **禁用全局 `exec 1>&2`**——stdout 整条通道留给 JSON-RPC，最后 `exec dsh --profile eterna-acp`；
  profile 渲染走 `flock $DSH_HOME/.profile-render.lock`（web 与 ACP 同时首启不并发写）；
- 安全边界：ACP 客户端可指定容器内任意绝对 `cwd` 与 stdio/HTTP MCP 命令——**只允许管理员/
  运维在本机启动，不暴露端口、不接终端用户**；需要绑定宿主机项目时把项目以相同绝对路径
  bind 进该 service。

```bash
# 构建（与 web 共用镜像；web 服务持有 build）
docker compose build
# 启动一次 ACP 会话（stdio；由 ACP v1 SDK 客户端驱动）
docker compose --profile acp run --rm -T eterna-agent-acp
```

**验证口径**（ACP 全组 E2E，P6）：ACP v1 SDK `initialize → session/new(绝对 cwd) →
session/prompt → session/cancel → session/close`；stdout 无任何非 JSON 行（非 JSON 日志只在
stderr）；`session/list` / `session/resume` 跨进程可用；治理 ask 以
`session/request_permission` 到达客户端，拒绝后工具不执行；SIGINT/SIGTERM drain 后退出。

**不要**在 web 容器里 `docker exec` 起第二个 ACP 进程作为默认路径（stdin/stdout 边界会被
entrypoint 日志污染）；独立 service 是唯一受支持形态。
