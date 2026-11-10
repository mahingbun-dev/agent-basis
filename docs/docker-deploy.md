# Eterna Agent 容器部署

> 2026-11-09 定案：本机 Docker 跑容器，NAS 反代做外网入口（IPv6 :443 已通，
> 证书有效）。镜像自包含：内核 `@deepseek-ai/dsh` 从 npm registry 装（钉
> 0.2.2-alpha.3，与验收实例同版），对源仓库零依赖。

## 快速开始

```sh
cp .env.example .env          # 填 LITELLM_API_KEY + 管理员账号（见下表）
docker compose up -d --build
# 访问 http://<本机局域网IP>:3210/login —— 用管理员账号登录（无需 token）
```

- 首次启动用户表为空时，`ETERNA_ACCESS_ADMIN_USER/PASSWORD` 自动播种为管理员。
- 登录后 dsh 会话自动铸发（`authenticatedUrl` 桥接），启动 token 不再是入口；
  容器日志里的 token 仅作运维兜底，日志视为敏感物。
- 换新浏览器/新设备 = 直接再登录；修改密码会使该账号全部旧会话下线。

## 配置即环境变量

| 变量 | 作用 | 缺省 |
| --- | --- | --- |
| `LITELLM_API_KEY` | 模型网关密钥（必填，apiKeyEnv 指名读取） | — |
| `ETERNA_LLM_BASE_URL` | 网关 openai-completions 根（带 /v1） | `http://192.168.31.165:4000/v1` |
| `ETERNA_PUBLIC_URL` | 反代场景对外根 URL（DSH `--public-url`） | 空（直连模式） |
| `ETERNA_TRUSTED_HOST` | `/api` 浏览器信任栏接受的 authority | 空 |
| `ETERNA_ACCESS_ADMIN_USER` | 管理员账号（首启播种，之后改密走 UI） | 空（不播种） |
| `ETERNA_ACCESS_ADMIN_PASSWORD` | 管理员初始密码（≥8 位；真值只放 .env，不入库） | 空 |
| `ETERNA_ACCESS_SECRET` | 会话签名密钥；留空自动生成落卷 `secret.key` | 空 |
| `ETERNA_ACCESS_SECURE` | 反代终结 TLS 时设 `1`（Secure cookie + 同源按 https） | 空 |

改 env 后 `docker compose up -d` 重启即热生效（entrypoint 每次启动重渲染
patch 到卷上；会话/存储/审计/用户库全在 `eterna-home` 卷，升级镜像不丢数据）。

## 账号门禁（eterna-access 插件）

- **不开放注册**：用户由管理员在「设置 → 用户管理」分区添加（重名自动追加
  数字后缀，如 `zhangsan` → `zhangsan01`；默认昵称=账号、头像=昵称首字母）。
- 用户自助 `/account`：改昵称、换/重置头像（png/jpeg/webp/gif ≤256KB）、改密码。
- 门禁语义：页面右上角角标在 `eterna_session` 失效时自动跳 `/login`；
  管理员删除用户 = 该用户会话即刻失效。登录限速：每 IP+账号 5 次/分钟，
  每 IP 变更类请求 30 次/分钟。
- 审计：登录（含失败）/登出/建删用户/资料与密码修改全部进审计 jsonl。
- 残余风险（R7/R3，计划书 §9）：插件挂载失败=门禁失效（启动日志会有 FAILED
  fiber，须关注）；bootstrap token 仍在容器日志，日志须按敏感物对待。

## 工作区隔离与插件启停（2026-11-10 起）

**工作区隔离（租户守卫）**：每个账号一个家目录 `$DSH_HOME/workspaces/<账号>/`——
工作区采纳（`workspace/create`）、目录浏览与创建（`directoryPicker/*`）、会话创建
（`session/create`）等 unary `/api` 端点由守卫按登录归属判定：路径钳制在家目录内、
他人工作区/会话一律拒绝（`tenant/denied`），全部进审计（`access.tenant` 事件）。
存量工作区启动时自动划归首个 admin。归属账本在 `/data/access/users.db`
（workspaces/sessions 表）。

已知限制（R12）：上游流端点（`workspace/follow` 走 WS mux `/api/remote.mux`）不经
守卫——工作区**列表元数据**（标题/路径名）对登录用户全局可见；数据读写/终端入口已
全部隔离。per-connection identity 列为上游需求项。

**插件停用/删除（实例级）**：管理员在侧栏「插件」页 →「恒灵插件」页签管理 L1 插件
（记忆/知识/诊断/品牌/面板/提示词工作室）；红线（治理/审计/出网/门禁）不可动。
- **停用**：可随时恢复；写 `/data/access/disabled-plugins.json`。
- **删除**（两击确认）：永久卸载语义；写 `/data/access/removed-plugins.json`
  并同步停用；「恢复」可撤销删除。
- **重启容器后** entrypoint 渲染管线裁剪对应 patch 行（不装载）——复用标准启动
  管线，零内核改动。多账号场景下插件语义为实例级（共享 owner 会话模型的约束，
  同 R12 根因）。

**插件开发铁律**：见 [docs/PLUGIN-AUTHORING.md](PLUGIN-AUTHORING.md) §1.1
（`packctl tenant-scan` CI 强制：持久化基路径/路由面独占/登记册独占写）。

## 外网入口（NAS 反代，用户自行配置）

实测拓扑：`eternity-electricity.cn` AAAA → 家宽 IPv6 → NAS nginx :443
（TrustAsia DV 证书有效至 2027-01；IPv4 A 记录不可达=家宽无公网 v4 映射）。

DSM 反代规则建议（Control Panel → Login Portal → Advanced → Reverse Proxy）：

- Source: HTTPS，hostname `eternity-electricity.cn`，端口 `<自选>`
- Destination: HTTP，`<Mac 局域网 IP>`，端口 `3210`，WebSocket ✓
- **保留 Host 头**（DSM 反代默认保留；`--trusted-host` 放行的是请求 Host
  authority，Origin fence 按 Host 判同源——本日 curl 矩阵实测）
- 然后在 `.env` 填 `ETERNA_PUBLIC_URL=https://eternity-electricity.cn:<端口>`、
  `ETERNA_TRUSTED_HOST=eternity-electricity.cn:<端口>`、`ETERNA_ACCESS_SECURE=1`，
  `docker compose up -d`。

安全基线：账号门禁（access）+ 建议反代层再加一道 basic auth 双保险；审计留痕
在卷 `/data/access/`（账号事件）与 `/data/workspaces/**/.eterna/`（会话事件）。

## 镜像内布局

- `/repo` — 仓库本体（workspace + node_modules + 构建产物 lib/）
- `/data` — DSH home（named volume）：`profiles/eterna-web/`（entrypoint 渲染）
  + 会话 + storages + 审计
- patch 模板 `docker/profile/cordis.patch.yml.template` = 验收实例 proven 配置
  收编（35 行：企业裁切 + 5 个 eterna 挂载 + llm-pi-ai 根级覆写 6 模型 +
  preset-standard/cordis 重述）；`__ETERNA_LLM_BASE_URL__` 占位符由 entrypoint
  sed 渲染——**模型密钥永不入镜像/模板**，走 env。
- 版本纪律：内核钉 `@deepseek-ai/dsh@0.2.2-alpha.3`（与 profile 内 @deepseek-ai
  symlink 同源，避免 preset 版本错配被静默 disable——2026-11-09 实测教训）。

## 与本地验收实例的关系

本地实例（宿主进程，端口 3107，home `.eterna-home-accept/`）用于开发验收；
容器实例（端口 3210，home 卷）用于云端部署。两者 profile 同源（同一 patch
模板基座），容器即「验收通过的配置」的部署形态。
