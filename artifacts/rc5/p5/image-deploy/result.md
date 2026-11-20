# P5 · 镜像 / entrypoint / compose / 数据根 / 反代（L5；T31/T37/T40–T45）

- 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`，基线 commit `02f4857`）
- 时间：2026-11-20（本地 UTC-8；cmd.log 内时间戳为 UTC）
- 边界：未 `git push/merge`；未 build/run 镜像、未停/改生产容器；未改 `packages/**` 产品源码、模板与其它 lane 文件。

## 1. 结论

1. **T40/T37 镜像**：Dockerfile 只 `npm i -g @deepseek-ai/dsh@0.2.2-rc.5`（`Dockerfile:85`），
   rc.1 时代三步 workaround（ENV 关闭自检 / peer 声明放宽 / node 直跑绕 pnpm run）全部删除
   （依据：`pnpm-lock.yaml` 中 `@deepseek-ai/dsh-type-meta` 命中 0 次；仓库 catalog 与内核同为 rc.5）。
   Node ≥24.9 有构建期断言（`Dockerfile:22`），dsh 版本/ mcp-client 同版/ acp-app 可达/ flock 存在
   全部构建期 fail-closed 探针（`Dockerfile:101-112`），构建末剥离 v1（`Dockerfile:49-57`），
   运行层再复核一次（`Dockerfile:116`）。
2. **mcp-client 收敛**：dsh 包内已带 `dsh-mcp-client@0.2.2-rc.5` 与 `dsh-acp-app@0.2.2-rc.5`
   （实测见 `probe-dsh-global-layout.txt`）；entrypoint 第 4 步改从
   `$DSH_PKG/node_modules/@deepseek-ai/dsh-mcp-client` 建链并做版本对账
   （`docker/entrypoint.sh:361-382`），不再单独全局安装。
3. **T41 office**：`fonts-noto-cjk fonts-liberation fonts-dejavu-core` + `fontconfig`；
   `python3-docx/python3-openpyxl` 走 apt，`python-pptx==1.0.2` 走 pip（bookworm 无
   `python3-pptx` apt 包，逐包核对见 `apt-package-evidence.txt`）；构建期
   `python3 -c 'import docx, openpyxl, pptx'` + 三条 `fc-list` 断言（`Dockerfile:108-111`）。
4. **T42 entrypoint 全链**：形态分派新增 `acp`（`docker/entrypoint.sh:49-69`）；ACP 下
   `log()` 逐条写 stderr（`:75-81`，全文件无 `exec 1>&2`）；`/data` mountpoint 预检
   （`:84-89`）；`DSH_AGENTS_HOME=/data/agents` 缺省 + 0700（`:40-41, 92-101`）；
   flock 渲染锁（`:391-400`）；rc.5 migrate 接线保持在 prompt 移植之后、relay sed 之前，
   且 ACP 跳过 web 默认 bundle / MCP servers 迁移（`:169-224`）；最后
   `exec dsh --profile eterna-acp`（`:430-431`）。
5. **T43 compose**：base/super 两份均改 bind 且 `:?` fail-closed（`docker-compose.yml:79`、
   `docker-compose.super.yml:63`），`external: true` 卷段删除；`ETERNA_CONTAINER_NAME/
   PORT/RELAY_PORT/INSTANCE/DATA_ROOT/IMAGE` 全参数化；ACP service `profiles:["acp"]`、
   `stdin_open:true`、`tty:false`、无 ports、healthcheck 关闭（`docker-compose.yml:99-126`）。
6. **T44 反代/部署文档**：`deploy/README.md §5` 增 `client_max_body_size 512m` +
   `proxy_read_timeout/proxy_send_timeout/client_body_timeout 1800s`（:162-165）；
   §4 迁移段整体重写为 host 数据根 runbook（named volume → bind，含冷备/复制/回滚）；
   新增 §11 ACP stdio 服务；`docs/docker-deploy.md` 同步 rc.5 内核/数据根/ACP。
7. **T45 数据目录/备份**：`deploy/init-data-dirs.sh` 幂等、根与实例 0700、拒绝相对路径/
   软链/git 工作树；`deploy/backup-data.sh` 冷备（停 → tar czf → 起，trap 兜底重启，
   排除 `office-kit/outputs` 与 `.pnpm-store`，0600）。均本地实测（见 §3）。

## 2. 改动文件

| 文件 | 任务 | 要点 |
|---|---|---|
| `Dockerfile` | T40/T41/T37 | 只装 dsh rc.5；删 workaround；node≥24.9 断言；字体+Python 与探针；v1 剥离+复核；`ENV DSH_AGENTS_HOME` |
| `docker/entrypoint.sh` | T31/T42 | acp 分支与 stderr 纪律；flock；mountpoint 预检；DSH_AGENTS_HOME；mcp-client 收敛与版本对账；acp 跳过 web 迁移/工坊移植/relay |
| `docker-compose.yml` | T43 | bind 数据根 `:?`；参数化；ACP service；删 external 卷；`DSH_HOME/DSH_AGENTS_HOME` |
| `docker-compose.super.yml` | T43 | bind 数据根（默认实例 `super-2`）；参数化；删 named volume |
| `deploy/init-data-dirs.sh` | T45 | 新增：幂等 0700、实例子目录、拒绝危险根 |
| `deploy/backup-data.sh` | T45 | 新增：冷备 + 排除 + 校验 + 0600 |
| `deploy/pre-restart-check.sh` | T43 伴随 | 容器名缺省取 `ETERNA_CONTAINER_NAME` |
| `deploy/README.md` | T44/T45 | 首次部署/迁移/反代 512m/升级/故障表/ACP §11 |
| `deploy/env.production.example` | T43/T45 | 新增 `ETERNA_DATA_ROOT/ETERNA_INSTANCE` 与参数化说明 |
| `docs/docker-deploy.md` | T44 | rc.5 内核、bind 数据根、v1 不进镜像、ACP 指针 |

## 3. 命令与断言（原文、EXIT、结果）

全部原文与完整输出见 **`cmd.log`**（29 段，每段 `$ 命令` + `EXIT=n`）；`summary.json` 由该日志机读生成
（不手写 EXIT）。关键项：

| # | 命令（原文见 cmd.log） | EXIT | 断言结果 |
|---|---|---:|---|
| 1 | `sh -n docker/entrypoint.sh` ／ `dash -n docker/entrypoint.sh`（#1/#22） | 0 / 0 | POSIX 语法（bash 与真 dash 双查） |
| 2 | `bash -n deploy/{init-data-dirs,backup-data,pre-restart-check}.sh` | 0 | 三脚本语法 |
| 2b | `python3 verify-dockerfile-runs.py Dockerfile`（#29） | 0 | 8 条 RUN 全部 `dash -n` 通过（按 BuildKit 语义剔除注释行后拼接续行） |
| 3 | `docker compose -f docker-compose.yml config` | 0 | 默认无 `eterna-agent-acp`（profiled 服务不随 `up` 起，计数 0）；卷 source=`/Users/sunny/eterna-data/super`→`/data` |
| 4 | `docker compose --profile acp -f docker-compose.yml config` | 0 | ACP 段：`profiles:[acp]`、`stdin_open:true`、`tty:false`（源文件 :104）、`published` 计数 **0**、`restart:'no'`、healthcheck disable |
| 5 | `env -u ETERNA_DATA_ROOT docker compose ... config` | **1** | fail-closed：`required variable ETERNA_DATA_ROOT is missing a value` |
| 6 | 参数覆写 config（name/port/relay/instance） | 0 | `eterna-agent-test` / `3108` / `9318` / `source:/tmp/eterna-data/test-20261120` |
| 7 | `docker compose -f docker-compose.super.yml config` | 0 | 3220/9320；source `…/super-2`；`DSH_AGENTS_HOME:/data/agents` |
| 8 | `init-data-dirs` 连跑两次 + `diff` | 0 | 输出逐字相同（幂等）；根/实例/agents/access/backups 均 `drwx------`（0700） |
| 9 | `ETERNA_DATA_ROOT=relative/dir bash deploy/init-data-dirs.sh` | **1** | 拒绝相对路径 |
| 10 | 根在 git 工作树内 | **1** | 拒绝（向上找祖先判定） |
| 11 | `SKIP_STOP=1 bash deploy/backup-data.sh super` | 0 | 归档 18 条目；含 `./access/users.db`；tar 列表无 `office-kit/outputs`、无 `.pnpm-store`；tgz `-rw-------` |
| 12 | `backup-data.sh nope` | **1** | 实例根不存在即拒（不再往下 tar） |
| 13 | mountpoint 谓词单测（48 §6.1 awk 原文） | 0 | 有 `/data` 行 → RC=0；无 → RC=1 |
| 14 | `MIMO_API_KEY=dummy dash docker/entrypoint.sh`（宿主无 `/proc/mounts`） | **1** | 打印 FATAL `/data 不是挂载点` 并拒启 |
| 15 | `MIMO_API_KEY=dummy ETERNA_FORM=bogus dash docker/entrypoint.sh` | **1** | 非法形态 fail-closed |
| 16 | `MIMO_API_KEY=dummy ETERNA_FORM=acp dash docker/entrypoint.sh`（到预检即止） | 0（断言命令） | **stdout = 0 字节**；`FATAL /data 不是挂载点` 只在 stderr（ACP stdout 纪律的局部实证） |
| 17 | npm -g rc.5 布局探针（`probe-dsh-global-layout.txt`） | 0 | 全局根只有 `dsh`；`dsh/node_modules/@deepseek-ai/{dsh-mcp-client,dsh-acp-app,dsh-agent-preset}` 全 0.2.2-rc.5；`dsh --version`=0.2.2-rc.5 |
| 18 | `grep` 反代文档 | 0 | `client_max_body_size 512m` / `proxy_read_timeout 1800s` / `proxy_send_timeout 1800s` |
| 19 | `grep` 数据根与 external 卷 | 0 | 两份 compose 均为 `${ETERNA_DATA_ROOT:?...}/<实例>`；两份 compose 文件内无 `external: true` / `eterna-home` 残留（历史卷名仅出现在 `deploy/README.md §4.2` 迁移 runbook） |

> 说明：上表所有 `docker compose config` 只做本地配置渲染与变量插值，不 build、不 run、不触碰容器；
> 各命令在 `cmd.log` 中的段号：compose base=#5、acp=#6、super=#10、参数覆写=#9、fail-closed=#8。

## 4. 未执行 / 不可执行（如实）

- **镜像构建与镜像内断言未跑**（本 lane 明确不 build）：`dsh --version`、mcp-client realpath、
  v1 剥离后的 `/repo` 断言、字体/Python 探针，都要等主线 gate 的 `docker build`；
  Dockerfile 里同名探针会在构建期 fail-closed。
- **容器内启动未跑**：web/ACP entrypoint 全链（`/data` 挂载点、flock、ACP stdout 纯净、治理 ask）
  需 E1/E4 容器环境；本条只到“宿主上到预检即止”的局部实证（#14–#16）。
- **`backup-data.sh` 的 stop/start 分支未跑**：会停生产容器（硬边界禁止）；只测了
  `SKIP_STOP=1` 的归档/排除/权限逻辑。
- **SQLite `integrity_check`、macOS FUSE 24h 浸泡**（48 §4.5/D0）属 P6b（T51）。
- **ACP/IMP/OFF 等 E2E**（54 §5.1）属 P6，未跑。

## 5. 遗留（RAID 口径）

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| R-P5-01 | `packages/prompt-studio/src/registry.ts:463-471` 的 `runtime.agent-loop` 锚点指向 v1 源（`packages/agent-loop/src/*`），镜像剥离 v1 后该条目在工坊里会显示 3 条 anchor problems（`checkEntryAnchors` registry.ts:679-698 / `readEntryText`:725，非致命、不影响 boot） | P2 | L2 把该条目标为 source-tree-only（跳过锚点读）或对缺失文件容错 |
| R-P5-02 | 根 `.env.example` 未加 `ETERNA_DATA_ROOT`（48 §10 要求 `.env.example` 与 `deploy/env.production.example` 都有）；根 README 仍有 named volume/旧端口叙述。该文件不在本 lane 白名单，未改 | P2 | L0/文档 lane 补 `.env.example` 一行并把 README 的卷叙述改为数据根 |
| R-P5-03 | 同根双容器（误配 `ETERNA_INSTANCE` 让 web/ACP 以外实例共享根）只有 compose 默认值 + 文档约束，没有运行期硬拒；渲染层已用 flock 串行化 | P2 | 可加 entrypoint 实例锁（写入 container 名，异主拒启），或在 gate 脚本断言两份 compose 根不同 |
| R-P5-04 | 镜像构建与容器 E2E 未跑（本 lane 禁 build/run）：Dockerfile 探针、ACP stdout、字体/Python、v1 剥离均由 gate 首次执行 | P1（验收未完成） | 主线 gate 跑 `docker build` + T48 断言 + T46 测试容器 + E4 ACP 全组；失败回滚到本 commit 前 |
| R-P5-05 | relay token 仍以 argv 传给 `sed -i` 与 relay `--token`（历史实现，本轮未动）；与「凭据不落 argv」纪律有张力 | P2 | relay CLI 支持 env/stdio 取 token 后改接线；sed 改 node 读 env |
| R-P5-06 | `docker-compose.super.yml` 默认实例取 `super-2`，与 48 §3.2 表（super compose → `super`）字面不一致；取 super-2 是为守住「双实例绝不共享根」铁律（表内 production 与 super 都写 super，本身冲突） | P3 | 主会话拍板后回写 48/50 文档，保持实现与文档同口径 |

## 6. 证据清单（本目录）

- `cmd.log` — 29 段命令原文 + EXIT + 输出（无凭据；仅宿主路径）
- `summary.json` — 由 cmd.log 机读生成（phase/commit/commands/leftovers/notRun；`imageTag=not-built`）
- `verify-dockerfile-runs.py` — Dockerfile RUN 级 `dash -n` 静态检查（可复跑）
- `probe-dsh-global-layout.txt` — npm -g dsh rc.5 布局与版本一致性实测
- `apt-package-evidence.txt` — bookworm 包名/版本核对（含 `python3-pptx` 无包 → pip 依据）