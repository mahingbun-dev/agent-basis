# 部署与服务迁移指南

> 本目录是 EternaAgent **部署配置的唯一权威存放点**：生产 env 模板（[env.production.example](env.production.example)）、
> 部署后验证脚本（[verify.sh](verify.sh)）、本指南。换机/迁移/重部署照此执行即可。
> 历史文档 [docs/docker-deploy.md](../docs/docker-deploy.md) 保留镜像与卷细节说明。

## 1. 拓扑总览

```text
外网用户 ── https://<域名>:<端口> ──▶ DNS(AAAA 推荐) ──▶ NAS nginx(TLS 终结, 保留 Host, WS✓)
                                                            │ 反代
内网用户 ── http://<Mac 内网 IP>:3210 ──────────────────────▶ Mac Docker(3210→8080) ──▶ eterna-agent 容器
                                                                              ├─ eterna-access 门禁(登录/用户/插件)
                                                                              ├─ 租户守卫(/api unary 归属判定)
                                                                              └─ dsh web + 全插件(卷持久化)
```

实测拓扑记录（2026-11-10）：公网入口为 `https://eternity-electricity.cn:3210`（DSM 反代）；
域名 A(v4 27.45.210.8) + AAAA 双栈并存，**v4 仅转发 443/8443**，v4:3210 未转发 → 浏览器
Happy Eyeballs 双栈竞速撞 v4 死路 = 间歇性「网络错误」。**修法 = DNSPod 删 A 记录（v6-only 推荐）**
或路由器补 v4:3210 转发。DNS 托管：DNSPod。

## 2. 配置的三层结构

| 层 | 位置 | 内容 | 入库？ |
| --- | --- | --- | --- |
| 模板 | `deploy/env.production.example` | 全变量+注释，非密值为当前部署实值 | ✅ |
| 机器真值 | `<repo>/.env`（gitignored） | 密钥真值（LITELLM_API_KEY / 管理员密码） | ❌ 永不 |
| 注入 | compose `environment` → 容器 env → entrypoint 参数/patch 渲染 | 见 env 模板内注释 | ✅（变量名） |

全变量清单见 [env.production.example](env.production.example)（模型网关 / 账号门禁 / 外网入口三组，
每个变量含作用与缺省说明）。**迁移服务时，`.env` 是唯一需要随身带的配置文件**。

## 3. 首次部署

```bash
cp deploy/env.production.example .env   # 填 LITELLM_API_KEY + 管理员密码
docker compose build && docker compose up -d
bash deploy/verify.sh                   # 部署验证清单（§7）
```

首次启动自动完成：profile 渲染（patch 模板 + 插件裁剪 + 治理规则渲染）→ `@eterna/*` symlink →
管理员播种（用户表为空时）→ `dsh web` 监听。

治理规则：entrypoint 每次启动把 `docker/profile/governance.rules.yml` 渲染到容器
`/repo/.eterna/governance.rules.yml`（governance-plugin 的读取点，缺文件=空规则集=
fail-closed 默认 ask；在 approval=never 的「完全权限」档即静默全拒——2026-11-10 事故，
规则集内工具名逐字对账见该文件头注）。免重建改规则：在卷上放
`access/governance.rules.yml`（存在即优先），重启容器生效；改后需跑
`packages/glue` 的 `governance-rules-fixture` 单测口径自行对账工具名。

## 4. 服务迁移（换机/换盘）

数据全部在 named volume `agent-basis_eterna-home`（用户库/会话/审计/profile/工作区）。

```bash
# ── 旧机：导出卷 + 带走 .env ──
docker run --rm -v agent-basis_eterna-home:/data -v "$PWD":/backup alpine \
  tar czf /backup/eterna-home.tgz -C /data .
# 保存 .env（含密钥）

# ── 新机：仓库 checkout → 恢复卷 → 启动 ──
cp <迁移来的 .env> .env
docker compose up -d --build          # 先建卷
docker run --rm -v agent-basis_eterna-home:/data -v "$PWD":/backup alpine \
  sh -c 'tar xzf /backup/eterna-home.tgz -C /data'
docker compose restart
bash deploy/verify.sh http://127.0.0.1:3210
```

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

DNS：推荐 **v6-only**（AAAA）。实测记录：家宽 v4 入站被运营商上游封死（v4:3210/8443
外部探测全败，转发规则形同虚设）；保留 A 记录会让浏览器双栈竞速间歇撞死路（「网络错误」）。

## 6. 验证清单

自动化：`bash deploy/verify.sh [BASE_URL]` —— 7 项门禁（登录页/匿名拒绝/管理员登录/
角色回显/红线清单/无会话拒绝/错密码 401），全过退出 0。

人工：登录落地对话一轮（真模型）→ 设置弹窗三分区（账号/用户管理）→ 插件页「恒灵插件」
页签 → 审计 jsonl 增长。

## 7. 升级

```bash
git pull && docker compose build && docker compose up -d
bash deploy/verify.sh
```

卷不删数据不丢（用户库/会话/审计全在卷内）；`disabled-plugins.json` /
`removed-plugins.json` 在每次启动时由 entrypoint 渲染管线应用。

## 8. 故障排查

| 症状 | 排查 |
| --- | --- |
| 外网登录「网络错误，请重试」 | 浏览器 fetch 层连接失败：①DNS 有 A 记录且 v4 未转发（删 A 走 v6）②DSM 反代未保留 Host/未开 WS ③容器重建窗口期 |
| 「跨源请求被拒绝」 | `.env` 三件套与实际访问的 scheme/域名/端口不一致：`ETERNA_PUBLIC_URL` 必须是浏览器地址栏的完整 https 根、`ETERNA_ACCESS_SECURE=1` |
| 登录后立刻被踢回登录页 | `ETERNA_ACCESS_SECRET` 被改动（轮换语义，全体会话下线） |
| 容器日志 `FAILED fiber` / eterna-access 未激活 | 门禁失效=裸奔窗口（R7）：查 users.db 可读性，重启容器 |
| 登录 429 | 限速窗口（每 IP+账号 5/min）未滑过 |
| 工具调用全部被拒 `the user rejected tool "…"`（毫秒级失败，无人点过拒绝） | 治理规则集未渲染/被清空：governance 空规则 fail-closed ask × 当前档 approval=never 即全拒。查容器内 `/repo/.eterna/governance.rules.yml` 是否存在、entrypoint 日志 `governance rules:` 行；修复见 §3 治理规则段 |

安全基线：`.env` 视为密钥（泄露即改管理员密码+换 `ETERNA_ACCESS_SECRET`）；容器日志中的
bootstrap token 视为敏感；公网入口建议反代层再加 basic auth 双保险。

## 9. 已知边界

- **R12**：上游流端点（WS mux）不经守卫——工作区列表元数据对登录用户全局可见；数据面已隔离
- **失败开放**（R7）：access 插件挂载失败时 web 仍起（无门禁）——监控启动日志 FAILED fiber
- 插件启停/删除为**实例级**语义（共享 owner 会话模型约束）；per-user 插件可见性列上游需求项

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
随机 token 落卷 `/data/relay-token`（重启不变）。取值：

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
