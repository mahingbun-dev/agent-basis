# rc.5 P0 基线证据包（T01/T02）

- 采集窗口：**2026-11-20 02:12–02:20（+08:00）／UTC 2026-11-19T18:12:51Z–18:20Z**
- 依据：54 §2.2（P0 审计）、54 §12.1 第 1 条（T01/T02：install/verify/双 boot/evals/生产 verify.sh + 旧镜像 digest + `/data` 冷备 + volume inspect + profile manifest，写 `summary.json`）、48 §7.1/§7.2（迁移前记录、冷备旧卷）、51 §0.3（证据规范：`cmd.log`/`result.md`、先脱敏、禁止凭据落盘）
- 执行现场：worktree `/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`，HEAD `02f485788411b9aed1938a3c4b009793a090961e`
- **证据根**：`artifacts/rc5/p0/run2/`（本轮实跑日志）。`artifacts/rc5/p0/{local,prod,backup,recon}/` 是上一次采集（01:35–02:02）的旧件，**保留不删**；本文件中的每个数值都来自 `run2/`，未引用旧件结论。
- 硬边界：未 `git push/merge`、未停/改生产容器、未改 compose、未写 `deepseek-harness`、未碰 `/Users/sunny/code/agent-basis`、未执行任何需要停机或凭据的步骤。生产侧全部为 `docker ps/inspect/exec cat` 与 `GET` 探针；冷备用 `-v 卷:/src:ro` 只读挂载。

---

## 0. 仓库与工具链快照

| 项 | 值 | 证据 |
|---|---|---|
| worktree / 分支 | `/Users/sunny/code/agent-basis-rc5` / `feat/dsh-rc5-merge` | `run2/local/repo-state.txt:2-3` |
| HEAD | `02f485788411b9aed1938a3c4b009793a090961e`（`rc5: P1 依赖族统一 0.2.2-rc.5 + …`） | `run2/local/repo-state.txt:4-5` |
| 采集时脏条目 | 72 条（18:18Z 快照，`git status --porcelain`，**含其它 lane 未提交改动**） | `run2/local/repo-state.txt:6` |
| `pnpm-lock.yaml` sha256 | `dfd900640d90bf3413bb6e2b8121a2f633a376871d65676f610e62fd80b0faa4` | 同上 `:7` |
| node / pnpm / docker server | `v24.18.0` / `11.7.0` / `29.7.2` | 同上 `:8-10` |
| 仓库内 dsh CLI 版本 | `0.2.2-rc.5` | 同上 `:11` |

> 工作树是多 lane 并发的活目标：本轮采集时 72 条；上轮记录为 56 条（该数值本轮未复核）。**本文件的 EXIT/断言值只对采集时刻成立**，不代表干净 HEAD。

---

## 一、本地基线（4 项，全部本轮实跑）

| # | 命令 | EXIT | 结果 | 证据 |
|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | `Scope: all 40 workspace projects` / `Already up to date` / `Done in 191ms using pnpm v11.7.0` | `run2/local/install-frozen.log` |
| 2 | `pnpm -w run verify` | **1** | UI 令牌检查通过；**22 个包 verify `Done`**；`@eterna/access` **Failed**，pnpm fail-fast 中止其余包 | `run2/local/verify.log` |
| 3a | `ETERNA_PROFILE_HOME=/tmp/eterna-rc5-p0-run2/web node scripts/verify-eterna-web.mjs` | **0** | **17/17 PASS**，`229 entries settled` | `run2/local/boot-web.log` |
| 3b | `ETERNA_PROFILE_HOME=/tmp/eterna-rc5-p0-run2/super node scripts/verify-eterna-super.mjs` | **0** | **21/21 PASS**，`235 entries settled` | `run2/local/boot-super.log` |
| 4 | `node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay --out artifacts/rc5/p0/run2/local/evals-replay-out` | **0** | `total=30 pass=30 fail=0` | `run2/local/evals-replay.log`、`run2/local/evals-replay-out/report.md` |

### 1.1 `pnpm -w run verify` 失败明细（P0 基线对照物）

- UI 令牌检查（root script 第一步）：`17 个目录 278 个文件,79 个 --et-* 令牌;状态点强制 30/30 通过;v4 阶梯 0 债务` —— 通过（`run2/local/verify.log:6`）。
- 失败包：`@eterna/access`，命令 `node scripts/build-client.mjs && oxlint --config ../../.oxlintrc.json . && tsc --noEmit && vitest run`，`Found 0 warnings and 16 errors`（`run2/local/verify.log:563`）。
- 16 条错误分布：**12 条在 `src/mcp-personal.ts`**（`git status` 记为 `??`，从未提交）；**4 条在 `src/store.ts`**（`M` 已修改）。`git status --porcelain packages/access/src/mcp-personal.ts packages/access/src/store.ts` → `?? mcp-personal.ts` / ` M store.ts`；`git log -1 -- packages/access/src/mcp-personal.ts` 无输出（未提交）。
- 规则分布（`run2/local/verify.log`）：`no-unused-vars`×6、`@stylistic/max-len`×2、`no-confusing-void-expression`×2、`no-unnecessary-type-assertion`×2、`eol-last`/`quotes`/`no-base-to-string`/`no-duplicate-type-constituents` 各 1。
- fail-fast 后未跑的包：pnpm 打印了下一条 `packages/prompt-studio verify$ …` 后即 `ELIFECYCLE`；**其余 16 个 workspace 的 verify 值未采集**。
- **未跑**：干净 HEAD 的 `pnpm -w run verify`（不在本 ask 范围；见遗留 P0-01）。

### 1.2 双形态真 boot 的口径与结果

两脚本均：把 `docker/profile/cordis.patch.yml.template` / `docker/profile/cordis.super.patch.yml.template` **逐字拷贝**进全新临时 `DSH_HOME`（`/tmp/eterna-rc5-p0-run2/{web,super}`），物化 profile 后以仓库内 `dsh@0.2.2-rc.5` 真 boot（`--port 0`、`--no-open`，脚本 `scripts/verify-eterna-web.mjs:252`），对活体 `pluginInventory/list` 断言；**无模型调用、无凭据、不连生产**（脚本内无 `3210` 引用）。

| 形态 | 断言 | entries settled | 裁切行 | 保留宿主行 | 渲染 patch sha256 | 行数 / `- id:` 行 | bundles |
|---|---|---|---|---|---|---|---|
| eterna-web | 17 PASS / 0 FAIL | 229 | 22 全 inactive | 128 enabled+active | `902c94b7…3ef0edf`（=模板，逐字） | 1058 / 146 | base、web-app、chat-import、session-search、plugin-market、terminal |
| eterna-super | 21 PASS / 0 FAIL | 235 | 22 全 inactive | 124 enabled+active；另有 **22 条 @eterna 挂载行全 active**；entryId 235 个全唯一 | `97d027b5…12a473`（=模板，逐字） | 1090 / 152 | 同 web 六件套 |

- 物化文件 sha256 与模板 sha256 逐一相等（`run2/local/render-fingerprint.txt`），证明「渲染 = 模板逐字」而非脚本自造配置。
- 两形态 `standard/minimal/cordis` 三个 preset 均在，`standard` 为默认；浏览器花名册 `__DSH_BOOT__` 注入且 combo 含 eternity 客户端包（web：prompt-studio/compaction/attachments/knowledge-admin；super 另含 tasks）。

### 1.3 `dsh-evals` replay

```
pack=/Users/sunny/code/agent-basis-rc5/packs/event-planning adapter=replay total=30 pass=30 fail=0   EXIT=0
```
- 分 tags：`acp-real` 6/6、`smoke` 9/9、`t14-replay` 20/20（`run2/local/evals-replay-out/report.md`）。
- duration 0.2s；产物 `events/`、`workspaces/`、`sessions.jsonl`（30 行）、`report.md`。
- **未跑**：`--adapter acp` 真跑（需 Python SDK/模型；ask 只要求 replay）。

---

## 二、生产只读盘点（E6 窗口，只读）

本机 `3210` 可达；`eterna-agent` 容器 `Up 54 minutes (healthy)`。所有操作 = `docker ps/inspect/exec cat` + `GET`。

### 2.1 容器

| 项 | 值 | 证据 |
|---|---|---|
| 容器 | `eterna-agent`，`running`/`healthy` | `run2/prod/docker-ps.txt`、`container-state.txt` |
| 镜像 | `eterna-agent:0.1.51` | 同上 |
| 镜像 ID | `sha256:3ca0d66055898b092f09761e5f67baa4a82741f1c7233d27bd2ddbd6de2b1a7b` | `run2/prod/image-inspect.json` |
| `RepoDigests` | `eterna-agent@sha256:3ca0d660…1a7b`（本地构建，无外部 registry digest） | 同上 |
| 容器创建 / 启动 | `2026-11-19T17:21:04Z` / `2026-11-19T17:21:06Z`；restart=`unless-stopped` | `run2/prod/container-state.txt` |
| 形态 | `ETERNA_FORM=super`；`DSH_HOME=/data`（其余 17 个 env key 全部脱敏不落盘） | 同上（`env_whitelist`，总 key 数 20） |
| 端口 | `3210→8080`、`9310→9310` | `run2/prod/docker-ps.txt` |
| compose | project=`agent-basis`，config=`/Users/sunny/code/agent-basis-main-0.1.51/docker-compose.yml`，env=`/Users/sunny/code/agent-basis/.env` | `run2/prod/container-state.txt` |
| 模板 bind | `agent-basis-main-0.1.51/docker/profile/cordis{,.super}.patch.yml.template` → `/repo/...`（ro） | 同上 + `volume-inspect` 同源 inspect |
| **容器内 dsh 版本** | **`0.2.2-alpha.3`**（`/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json`） | `run2/prod/container-dsh-version.txt` |

> 生产镜像 runtime 仍是 alpha.3 内核，与本分支 catalog `0.2.2-rc.5` 不同代——rc.5 上线必须由 L5 改 `Dockerfile` 重建；本 lane 只记录不改（遗留 P0-03）。

### 2.2 数据卷（48 §7.1）

| 项 | 值 | 证据 |
|---|---|---|
| 卷名 | `agent-basis_eterna-home` | `run2/prod/volume-inspect.json` |
| 创建 | `2026-11-09T08:38:27Z` | 同上 |
| 挂载点 | `/var/lib/docker/volumes/agent-basis_eterna-home/_data`；容器 `/data`（`rw`） | 同上 + `container-state.txt` |
| compose 标签 | project=`agent-basis`，volume=`eterna-home`，config-hash=`6f86bb7b…95f0` | 同上 |

### 2.3 `/data` 顶层与大小（48 §7.1）

`run2/prod/data-top-level.txt`。**19 个顶层条目**，总量约 **77 MB**：
`profiles` 34M、`sessions` 15M、`market` 14M、`storages` 4.8M、`workspaces` 4.2M、`.pnpm-store` 2.5M、`.eterna` 2.2M、`attachments` 348K、`access` 168K、`eterna-prompt-studio` 108K、`logs` 68K、`memory-distill` 36K、`knowledge-admin` 24K，其余 4.0K 级；含敏感文件 `.credentials.yaml`（0600）与 `relay-token`（0600）。

### 2.4 profile manifest 快照（48 §7.1「用户装品清单」）

| profile | package.json sha256 | cordis.patch.yml sha256 | patch 行 / `- id:` 行 | bundles |
|---|---|---|---|---|
| `eterna-super` | `8bb20d49…fba1a` | `cd0e8815…d8a7f` | 1036 / 151 | 13 项：base、web-app、**hello-market（git pin）**、plugin-market、voice-input、auto-review、forge、personalized-recommendations、inspector-profile、cot-translation、session-titles、agent-team-profile、badge-skill |
| `eterna-web` | `9153514a…1e8d5d` | `7cf1287a…3b76ec` | 999 / 143 | 13 项：base、web-app + 10 个实验 bundle + **knowledge-admin（link）** |
| `web` | `210068dd…626398` | `ef189a8c…461f027` | 4 / 0 | base、web-app |

- 用户装品原样记录（`run2/prod/profiles/*.package.json`）：
  `@eterna/hello-market: github:mahingbun-dev/eterna-plugins#1633fc451214009b3f1b2ffac74d4670d85bed75&path:/bundles/hello-market`；
  `@eterna/knowledge-admin: link:/data/workspaces/Mr.Ma/kh-admin-plugin`。
- 原文件已过密钥扫描：`grep -niE "key|token|secret|password|sk-|bearer|apikey"` 在 profile 快照上 **0 命中**（`container-state.txt` 的命中仅为白名单字段名 `"key"`）。
- 生产模板（容器 `/repo/docker/profile/`）：base `fa6b2528…88ea` 990 行；super `06158841…aeeb3c` 1024 行。对照本地 rc.5 模板 1058/1090 行 → **升级面 base +68 行、super +66 行**（`run2/prod/profiles-fingerprint.txt`、`run2/local/render-fingerprint.txt`）。
- 与旧件一致：prod `eterna-super/package.json` 的 `name` 仍是 `dsh-profile-eterna-web`（遗留 P0-06）。

### 2.5 生产 `deploy/verify.sh`（本机 3210 可达）

**全量未执行**：脚本第 3/4/5 项与 8.5 运行时探针需要管理员账号密码（从 `.env` 读取，`deploy/verify.sh:19-22`），且实现把明文密码放进 `curl -d` **argv**（`deploy/verify.sh:37-41`）；第 6/7 项是 `POST` 语义。与「凭据不落 argv / 生产只读 / 需凭据步骤不执行」冲突，故只跑**逐条同源的免凭据只读子集**：

| 脚本条目 | 期望 | 实测 | 判定 |
|---|---|---|---|
| 1 登录页 `GET /login` | 200 | `200 text/html` | ✅ |
| 2 匿名 `GET /access/api/me` | 401 | `401` | ✅ |
| 2.5 匿名根路径 | 302 → `$BASE/login` | `302 http://127.0.0.1:3210/login` | ✅ |
| 8 治理规则活性（`docker exec`） | `1 1` | `1 1`（default 显式 + allow-fs） | ✅ |
| 8.5 知识底座静态装载 | web/super 任一 | `eterna-super`（patch baked row + symlink 在位） | ✅ |
| 8 中继 `/api/status` | 200 | `200` | ✅ |
| 9 扩展包 `Range 0-1` | `PK` | `PK` | ✅ |
| 10 指引页 `/companion/guide` | `200 text/html` | `200 text/html` | ✅ |

证据：`run2/prod/verify-sh-readonly-subset.log`。
**未跑**：3 管理员登录、4 `me=admin`、5 插件红线清单、8.5 运行时 `knowledgeAdmin/overview`、6 未会话改昵称 401（POST）、7 错密码 401（POST）。**这些项的基线值未采集，不得假定通过。**

---

## 三、冷备（48 §7.2）

| 项 | 值 |
|---|---|
| 命令 | `docker run --rm --entrypoint sh -v agent-basis_eterna-home:/src:ro -v $HOME/eterna-data/backups/rc5-2026-11-20:/backup eterna-agent:0.1.51 -c 'tar czf /backup/eterna-home-20261120-021802.tgz -C /src .'` |
| EXIT | **0**（`2026-11-19T18:18:02Z`→`18:18:04Z`，约 2s） |
| 产物 | `/Users/sunny/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz`（**26,566,225 B ≈ 25.3 MiB**） |
| sha256 | `5976686ff2caab6a668c7231daded925c10053e062b9d4b28ecb31e61fbbd281` |
| 归档条目 | 10,466（其中 `.db`/`.sqlite3` 16 个） |
| 完整性 | 只解包 DB 文件到 `/tmp`，对 **16 个 SQLite** 跑 `PRAGMA integrity_check`：**16/16 ok**，EXIT=0；临时目录已删除（不含凭据文件） |

证据：`run2/backup/backup-run.log`、`backup-verify.log`、`backup-integrity-check.log`；目录权限 `0700`。

> 这是**活卷 tar**（未停容器、未冻结写入），一致性由事后 `integrity_check` 反证；不等同 48 §7.1 的「确认无运行中 turn」口径。正式迁移窗口应按 48 §7.1 `pre-restart-check.sh` 后重做一份。备份包本体含 `.credentials.yaml`/`relay-token`，属敏感物，不得入 git/镜像/工单（遗留 P0-04）。

---

## 四、回滚点

| 回滚层 | 资产 | 可用性 |
|---|---|---|
| 镜像（当前） | `eterna-agent:0.1.51`，`sha256:3ca0d660…1a7b`（2026-11-19T17:19:57Z） | 在册 |
| 镜像（回滚） | `eterna-agent:0.1.50`，`sha256:6b306037b6593d94e7c797a97f15e8fb7f60fe97f871fd673da6ce659e7b2052`（2026-11-19T10:41:00Z） | 本地在册 |
| 镜像（更早兜底） | `eterna-agent:0.1.38`，`sha256:b0dbe8bc6da4c918ee1a848548d92980d8caba4bb5301b26c5878932b5ae95e1` | 本地在册 |
| 数据 | `eterna-home-20261120-021802.tgz` + sha256（§三） | 已校验 |
| compose | **未改动**（本 lane 只读）；生产 compose 在 `/Users/sunny/code/agent-basis-main-0.1.51/docker-compose.yml` | 原样 |
| **未验证** | 冷备**恢复演练**（需临时实例解包启动） | **未跑**，遗留 P0-05 |

证据：`run2/prod/image-list.txt`、`run2/prod/image-inspect-rollback.txt`。

---

## 五、未执行项（如实登记）

| # | 项 | 原因 |
|---|---|---|
| 1 | 干净 HEAD 的 `pnpm -w run verify` | 本 ask 指定在当前 worktree；需隔离工作树，见 P0-01 |
| 2 | `deploy/verify.sh` 全量（登录/me/插件红线/KB overview 运行时） | 需管理员凭据；脚本把密码放 curl argv |
| 3 | `dsh-evals --adapter acp` 真跑 | ask 只要求 replay |
| 4 | 冷备恢复演练 | 需建临时容器/独立数据根，超出本次只读边界 |
| 5 | 生产容器内 SQLite 在位 `integrity_check`（48 §7.5） | 迁移后验收步骤；本轮只验了备份副本 |
| 6 | 全新检出 + 冷装（`--store-dir` 隔离） | `install` 为 `Already up to date`，未覆盖冷装路径（P0-07） |

---

## 六、遗留（RAID 条目）

- **P0-01**｜`pnpm -w run verify` 在本轮工作树 **EXIT=1**：16 条 oxlint 错误全在 L4 未提交改动（12 条未跟踪 `packages/access/src/mcp-personal.ts` + 4 条已修改 `src/store.ts`），22 包 Done 后 fail-fast 中止，其余 16 个 workspace 未采集｜**P1**｜L4 收口这 16 条后由 L0 复跑并把新 EXIT 登记为基线；在此之前本文件 EXIT=1 是唯一对照物。
- **P0-02**｜生产 `deploy/verify.sh` 未全量执行（凭据进 curl argv + POST 语义）｜**P1**｜给脚本加 stdin/文件读凭据与 `--readonly` 模式，或由有凭据运维在迁移窗口跑完并归档到 `artifacts/rc5/p0/`。
- **P0-03**｜生产镜像 0.1.51 经容器内实测仍是 `dsh@0.2.2-alpha.3`，与本分支 catalog `0.2.2-rc.5` 不同代｜**P1（L5）**｜rc.5 上线前改 Dockerfile 钉版并重建镜像。
- **P0-04**｜冷备为活卷 tar（未冻结写入），备份包内含 `.credentials.yaml`/`relay-token`｜**P2**｜迁移窗口按 48 §7.1 在 `pre-restart-check.sh` 后重做；备份目录保持 `0700`，禁止入 git/镜像/工单附件。
- **P0-05**｜冷备**恢复路径未演练**（无临时实例解包启动）｜**P2**｜用 E1 隔离实例（独立端口/独立数据根）做「解包→boot→登录→会话可见」演练并归档。
- **P0-06**｜生产 `profiles/eterna-super/package.json` 的 `name` 仍是 `dsh-profile-eterna-web`（模板沿袭），profile 目录名与 manifest name 不一致｜**P3**｜L2 模板侧统一命名；不影响装载，排障易误判。
- **P0-07**｜`pnpm install --frozen-lockfile` 为 `Already up to date`，未验证「全新检出 + 冷装」路径｜**P3**｜需要时在临时目录用 `--store-dir` 隔离复跑。
- **P0-08**｜工作树在采集期间持续被其它 lane 写入（本轮快照 72 条；上轮记录 56 条），`verify` 结果可能随 WIP 变化｜**P2**｜基线以采信时刻为准；P0-01 收口后固定一次「干净基线」并冻结。

---

## 七、证据索引

| 组 | 文件 |
|---|---|
| 本地 | `run2/local/{install-frozen.log,verify.log,boot-web.log,boot-super.log,evals-replay.log,evals-replay-out/**,render-fingerprint.txt,repo-state.txt}` |
| 生产 | `run2/prod/{docker-ps.txt,container-state.txt,image-inspect.json,image-inspect.exit,image-list.txt,image-inspect-rollback.txt,volume-inspect.json,data-top-level.txt,profiles-list.txt,profiles/*.package.json,profiles-fingerprint.txt,container-dsh-version.txt,verify-sh-readonly-subset.log}` |
| 冷备 | `run2/backup/{backup-run.log,backup-verify.log,backup-integrity-check.log}`；归档本体在 `$HOME/eterna-data/backups/rc5-2026-11-20/`（**不在仓库内**） |
| 汇总 | `artifacts/rc5/p0/summary.json`（机器可读版，同一批值） |
| 旧件（上轮，保留） | `artifacts/rc5/p0/{local,prod,backup,recon}/`、`baseline.md`/`summary.json` 的上轮内容已被本次覆盖 |