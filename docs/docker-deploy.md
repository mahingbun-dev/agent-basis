# Eterna Agent 容器部署

> 2026-11-09 定案：本机 Docker 跑容器，NAS 反代做外网入口（IPv6 :443 已通，
> 证书有效）。镜像自包含：内核 `@deepseek-ai/dsh` 从 npm registry 装（钉
> 0.2.2-alpha.3，与验收实例同版），对源仓库零依赖。

## 快速开始

```sh
cp .env.example .env          # 填 LITELLM_API_KEY（本机: cat .secrets/litellm-master-key.txt）
docker compose up -d --build
docker compose logs eterna-agent | grep -o 'token=[A-Za-z0-9_-]*'   # 登录 token（一次性）
# 内网访问: http://<本机局域网IP>:3210/?token=<token>
```

- 首次浏览器连接消费 bootstrap token；BrowserAuth 会话签名落卷，重启不掉线。
- 换新浏览器/新设备 = `docker compose restart` 取新 token。

## 配置即环境变量

| 变量 | 作用 | 缺省 |
| --- | --- | --- |
| `LITELLM_API_KEY` | 模型网关密钥（必填，apiKeyEnv 指名读取） | — |
| `ETERNA_LLM_BASE_URL` | 网关 openai-completions 根（带 /v1） | `http://192.168.31.165:4000/v1` |
| `ETERNA_PUBLIC_URL` | 反代场景对外根 URL（DSH `--public-url`） | 空（直连模式） |
| `ETERNA_TRUSTED_HOST` | `/api` 浏览器信任栏接受的 authority | 空 |

改 env 后 `docker compose up -d` 重启即热生效（entrypoint 每次启动重渲染
patch 到卷上；会话/存储/审计全在 `eterna-home` 卷，升级镜像不丢数据）。

## 外网入口（NAS 反代，用户自行配置）

实测拓扑：`eternity-electricity.cn` AAAA → 家宽 IPv6 → NAS nginx :443
（TrustAsia DV 证书有效至 2027-01；IPv4 A 记录不可达=家宽无公网 v4 映射）。

DSM 反代规则建议（Control Panel → Login Portal → Advanced → Reverse Proxy）：

- Source: HTTPS，hostname `eternity-electricity.cn`，端口 `<自选>`
- Destination: HTTP，`<Mac 局域网 IP>`，端口 `3210`，WebSocket ✓
- 然后在 `.env` 填 `ETERNA_PUBLIC_URL=https://eternity-electricity.cn:<端口>`
  与 `ETERNA_TRUSTED_HOST=eternity-electricity.cn:<端口>`，`docker compose up -d`。

安全基线：DSH token + 建议反代层再加一道 basic auth；审计留痕在卷
`/data/workspaces/**/.eterna/`。

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
