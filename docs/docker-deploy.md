# 容器镜像与卷布局

> 部署操作/env 全表/外网入口/服务迁移见 **[deploy/README.md](../deploy/README.md)**。
> 2026-11-09 定案：本机 Docker 跑容器，NAS 反代做外网入口。镜像自包含：内核
> `@deepseek-ai/dsh` 从 npm registry 装（rc.5 起钉 **0.2.2-rc.5**，与验收实例同版），
> 对源仓库零依赖。本页仅保留镜像内部结构与版本纪律细节。

> 部署操作、env 全表、外网入口、服务迁移已迁移至 **[deploy/README.md](../deploy/README.md)**
> （部署与服务迁移指南，含配置模板 [env.production.example](../deploy/env.production.example)
> 与验证脚本 [verify.sh](../deploy/verify.sh)）。本页仅保留镜像内部结构与版本纪律细节。

## 镜像内布局

- `/repo` — 仓库本体（workspace + node_modules + 构建产物 lib/）
- `/data` — DSH home（**宿主 bind 目录** `${ETERNA_DATA_ROOT}/<实例>`，容器内路径不变）：
  `profiles/eterna-web|eterna-super|eterna-acp/`（entrypoint 渲染）+ 会话 + storages +
  审计 + `agents/`（`DSH_AGENTS_HOME`，rc.5 用户级 AGENTS/skills）
- patch 模板 `docker/profile/cordis.patch.yml.template` = 验收实例 proven 配置
  收编（企业裁切 + eterna 挂载块 + llm-pi-ai 根级覆写 + preset 重述）；`__ETERNA_RELAY_TOKEN__`
  占位符由 entrypoint 在卷上渲染——**模型密钥/令牌永不入镜像/模板**，走 env。
- 版本纪律（T37/T40）：内核只装 `@deepseek-ai/dsh@0.2.2-rc.5`；`dsh-mcp-client` /
  `dsh-acp-app` 等 @deepseek-ai 依赖**随内核自带**（`<dsh>/node_modules/@deepseek-ai/*`），
  不再单独全局安装——两个全局包各自解析版本族会漂移，错版被 dsh 静默 disable
  （2026-11-09 实测教训的 rc.5 收敛形态）。构建期探针断言 `dsh --version` 与
  mcp-client 版本一致、v1 源已剥离、字体/Python 可用。
- v1 线（`core/`、`basis.yml`、6 个 `@basis/*`）**不进运行镜像**：build 阶段末尾剥离，
  不能用 `.dockerignore`（否则 workspace install 缺包；50 §3.3）。

## 与本地验收实例的关系

本地实例（宿主进程，端口 3107，home `.eterna-home-accept/`）用于开发验收；
容器实例（端口 3210，宿主 bind 数据根）用于云端部署。两者 profile 同源（同一 patch
模板基座），容器即「验收通过的配置」的部署形态。

ACP 是独立 stdio service（`profiles: ["acp"]`，无端口），与 web 共享同一 `/data` 实例根，
见 [deploy/README.md §11](../deploy/README.md)。