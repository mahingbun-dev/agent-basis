# 可执行计划书：Eterna 全套改名 · Docker 容器化 · 云端部署与回归

> 生成：2026-11-09 16:15 ｜ 状态：待执行

## 1. 一句话目标

把 agent-basis 仓库全量改名为自有品牌 **eterna**（`@basis/*`→`@eterna/*`、`basis-*`→`eterna-*`、profile/env/脚本/文档文件名全套），建立上游合并映射文档；提供 Docker 镜像与本机部署；按逻辑分组提交并推送 dev 分支；容器实例通过端到端回归（品牌面/模型配置/诊断面板/真实对话/审计）后交付 NAS 反代衔接参数。

## 2. 背景

- 平台统一要求：插件体系此前用 `basis` 前缀（与上游 DeepSeek Harness 的 `@deepseek-ai` 内核并存），品牌已定「恒灵·EternaAgent」，包名/id 需对齐。
- 实测（2026-11-09）：运行内核 `@deepseek-ai/dsh` 来自 **npm registry**（全局 CLI 与 node_modules 均为 registry 安装），对 `deepseek-harness` 源仓库的真实耦合只剩文档/脚本路径参照与 skills fork 叙事——解耦成本低。
- dev 分支从未推送（origin 只有 main + v0.1.0）；工作区 50+ 文件待提交；密钥扫描已过（5 个匹配全为注释/env 名误报）。
- 外网拓扑实测：`eternity-electricity.cn` AAAA → 家宽 IPv6 → NAS nginx :443（证书有效，TrustAsia DV，2027-01 到期，SAN 仅主域名）；IPv4 A 记录 80/443/8443 全不通。LiteLLM 网关（192.168.31.165:4000）已恢复（401=活着）。

## 3. 访谈结论（已确认决策）

| 维度 | 结论 |
| --- | --- |
| 目标 | 三任务一次交付：eterna 全套改名+映射文档；Docker 化；提交推送+Mac 部署+E2E 回归 |
| 范围 | **全套改名**（包名/插件 id/profile 名/env/脚本与文档文件名）；容器跑 **Mac Docker**；外网入口由用户自行配 NAS 反代端口 |
| 约束 | 官方内核 id 不可改（`llm-pi-ai`/`agent-default-model`/`credentials`/`preset-*`/`ui-*`）；`@deepseek-ai/*` npm 依赖保留（升级通道）；数据不出内网纪律；凭据只进 `.secrets/` 与 gitignored `.env` |
| 资源 | 本机 Docker 29.7.2（linux/aarch64）；NAS 反代证书已就绪；LiteLLM 已恢复；宿主端口 3210/8080 空闲 |
| 优先级 | 改名 → 提交推送 → Docker 部署 → E2E 回归 → 反代衔接交付 |
| 验收标准 | ① `pnpm -r verify` 全绿且全仓 rg 无 `basis` 残留（误替换为零）② origin/dev 推送成功 ③ 容器实例浏览器 E2E 五项全过 ④ 用户拿到反代目标参数 |

## 4. 待定项与默认假设

| 待定项 | 默认假设 | 再确认时机 / 负责人 |
| --- | --- | --- |
| NAS 反代规则（源端口/目标） | 用户自行配置；交付 DSM 规则建议稿 | 容器部署完成后 / 用户 |
| 容器宿主端口 | 3210（已核实空闲） | 反代配置时如需换端口只改 compose |
| 公网认证强度 | DSH 自带 token（docker logs 取）为基线；建议反代层加 basic auth（用户侧） | 外网开通时 |
| 镜像内核钉版 | 与验收实例同版（实施时核对 profile 实际 bundle 版本，rc.1/alpha.3 以 boot 日志为准） | Dockerfile 编写时 |
| GitHub 仓库名 agent-basis 是否改 eterna | 不改（仓库名变更影响 remote/CI，非本轮） | 用户有需要时 |

## 5. 范围

- 做：全套改名（含 `tools/basis-smoke`→`eterna-smoke`、`profiles/basis-*`→`eterna-*`、`scripts/verify-basis-web.mjs`→`verify-eterna-web.mjs`、`docs/basis-web-profile.md`→`eterna-web-profile.md`、本地 `.basis-home-accept`→`.eterna-home-accept`）；映射文档 `docs/eterna-plugin-mapping.md`；源仓路径引用清理；Dockerfile + compose + entrypoint；逻辑分组提交 + push dev；容器部署与五项 E2E；反代衔接参数交付。
- 不做：`@deepseek-ai/*` 内核 vendor 化；官方 entry id 改名；NAS 上部署容器（本轮 Mac）；仓库名/域名/DNS/证书变更；git 历史重写。

## 6. 任务分解

| # | 任务 | 依赖 | 产出 | 验收标准 |
| --- | --- | --- | --- | --- |
| A1 | 提交既有工作区成果（按逻辑分组：品牌全案 / llm-doctor / T8-T12 治理面 / 文档） | — | 干净的分组提交历史 | 改名前工作区归零，后续改名 diff 纯净可读 |
| A2 | 改名映射表先行（唯一事实源）：eterna 名 ↔ 旧 basis 名 ↔ 上游源仓路径 ↔ 说明 | A1 | `docs/eterna-plugin-mapping.md` 草稿 | 覆盖 15 包+全部 entry id+profile/env/脚本；含「不可改名官方 id」清单 |
| A3 | 机械替换执行：包名、entry id、patch yml、import、测试断言、脚本名、profile 目录（git mv）、本地 home 目录与 symlink 重建 | A2 | 全仓 eterna 化 | 全仓 rg `basis-`/`@basis` 零残留（白名单除外）；英文词 basis 语境零误伤 |
| A4 | 源仓解耦清理：`deepseek-harness` 路径引用改为映射文档引用；fork 升级对照叙事收口到映射文档 | A3 | 解耦后的文档/脚本 | rg 源仓绝对路径零残留（映射文档内的对照列除外） |
| A5 | 全量回归（源层）：`pnpm -r verify` + 重启本地实例（eterna-web profile）浏览器冒烟 | A3-A4 | 回归记录 | verify 全绿；浏览器品牌/模型页/对话正常 |
| B1 | Dockerfile 多阶段构建（builder: pnpm install + 四包 build:client；runtime: node:22 + registry 装 `@deepseek-ai/dsh` + profile 组装 + @eterna symlink） | A5 | `Dockerfile` + `.dockerignore` | 本机 `docker build` 成功出镜像 `eterna-agent` |
| B2 | entrypoint + compose：容器 IP 解析（`--host` 拒绝通配）→ `dsh web --host $IP --port 8080 --no-open --public-url/--trusted-host`；env 注入；home 卷持久化；3210→8080 | B1 | `docker/entrypoint.sh` + `docker-compose.yml`（env 引 gitignored `.env`） | `docker compose up -d` 起服务，日志打印 token |
| C1 | 推送：dev → origin（首次推送） | A1 | origin/dev | `git push -u origin dev` 成功；推送前复扫密钥 |
| D1 | 容器实例 E2E 回归：①品牌面（恒灵·EternaAgent/闪电标/标语）②模型配置页（pi-ai 满血编辑器+连接测试拉 LiteLLM /models）③llm-doctor 面板（折叠/测试/限高）④真实对话（经 LiteLLM deepseek-flash）⑤审计 jsonl 落卷 | B2 | 回归记录（含截图） | 五项全过；token 登录链路可用 |
| D2 | 反代衔接交付：NAS 反代目标（Mac 局域网 IP:3210）+ DSM 规则建议（HTTPS 源→HTTP 目标、WebSocket 开）+ 安全注记 | D1 | 交付说明（计划书附录或对话内） | 用户可照抄配置 |

## 7. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 改名遗漏/英文词 basis 误替换 | 功能断裂或语义破坏 | 精确串替换非盲替（`basis-`/`@basis` 带边界）；替换后全仓 rg 残留扫描 + verify + 浏览器 E2E 三保险 |
| 官方 id 误改 | 设置页编辑器映射断、启动失败 | 映射文档「不可改名清单」作为评审门；`llm-pi-ai`/`agent-default-model` 等显式豁免 |
| 容器 `--host` 通配被拒 | 起不来 | entrypoint 解析 eth0 具体地址再传参 |
| 反代后 `/api` 浏览器信任栏拒绝 | 外网页面 401/拒连 | `--public-url` + `--trusted-host` 原生参数；D2 交付参数时核对 |
| LiteLLM 再度下线 | 对话/连接测试失败 | NAS LiteLLM 为准；mock 网关留作备份（容器外） |
| 公网暴露安全面 | 会话被未授权访问 | token 基线 + 建议反代 basic auth（用户侧）+ 审计留痕；IPv4 天然不可达（现状） |
| 推送公开仓 | 内网 IP 已有 main 先例；密钥已扫零 | 推送前复扫一次密钥模式 |

## 8. 验证方式

- 源层：`pnpm -r verify`（15 包 lint+typecheck+test）；`rg -i "\bbasis\b"` 白名单扫描。
- 容器层：`docker compose up -d` 日志无 error、打印 token；`curl` 健康检查。
- 浏览器层：web-gui-tester/IAB 五项回归（D1 清单），截图留档。
- 外网层：用户配好反代后 `https://eternity-electricity.cn:<端口>` 打开即登录（用户验收）。

## 9. 下一步（第一个动作）

- 动作：A1 按逻辑分组提交既有工作区成果（品牌全案 → llm-doctor → 治理面 → 文档），随后进入 A2 映射文档。
- 时间 / 负责人：本轮会话立即执行 / ZCode。

## 10. 信息来源

- 实测：`npm view`（registry 可达）、`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`（内核 registry 安装+全 bundle 家族）、`dsh web --help`（`--public-url`/`--trusted-host`/`--tls-*`）、`dig`/`curl`（域名 AAAA→NAS nginx :443、证书 TrustAsia DV 有效至 2027-01、IPv4 全端口不通）、LiteLLM :4000 存活（401）、宿主端口 3210/8080 空闲、`git ls-remote`（origin 仅 main+v0.1.0）、密钥扫描（5 匹配全误报）。
- 会话记忆：品牌定案（恒灵·EternaAgent/闪电标/「方寸灵台，运筹万里」）、pi-ai 承载配方、`llm-pi-ai` 官方 id 硬编码事实。
