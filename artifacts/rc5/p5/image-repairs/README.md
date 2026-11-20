# P5 · 镜像构建失败修复（apt 断链 → exit 100）

- 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`，基线 commit `02f4857`）
- 时间：2026-11-20
- 范围：只改 `Dockerfile`、`docker-compose.yml`、`docker-compose.super.yml`、`deploy/env.production.example`；
  未改 entrypoint（与本次失败无关），
  未碰 `packages/**`，未停/改生产容器，未 `git push/merge`。
- 脱敏：本次证据只含公开包名/URL/构建日志，无凭据（仓库 `.npmrc` 无 token，构建未注入任何 key）。

## 1 结论

**根因不是「包缺失/版本不对」，而是「瞬时断链 + 构建层零容错、零复用」。**

失败行是 runtime 阶段 `Dockerfile:78`（修复前）的 apt 段。事实链：

1. **现场**（ask 提供的构建输出）：`53s` 拉完 `104 MB`（1952 kB/s）后，成批 `.deb` 报
   `Could not connect to deb.debian.org:80 (151.101.74.132), connection timed out`，
   `apt-get install` **exit 100** → 整个 `RUN` 失败。
2. **同一包清单在链路正常时 28s 装通**（`repro-apt-install.txt`，EXIT=0）→ 排除包名/版本问题。
3. **apt 默认不重试**：基镜像 `apt-config dump | grep -i retries` 无该键（=0）；
   坏源对照实测 `Acquire::Retries=0` 只尝试 1 次、`=3` 连续 3 次 `Ign:` 重试
   （`proof-apt-retries.txt`）。事故正是「连接超时」这一类可重试错误 → 一次抖动就直接炸整层。
4. **零复用**：该 `RUN` 没有任何 cache mount，每次重建都要重下 ~104 MB apt 包 + 全局 dsh
   （npm）+ pnpm 依赖；重建次数越多，撞上瞬时断链的概率越高——重跑本身才是最大的风险暴露面。

## 2 改动

| 文件 | 位置 | 改动 | 作用 |
|---|---|---|---|
| `Dockerfile` | 文件头（`ARG DEBIAN_MIRROR=` 全局 + 两阶段各 `ARG`） | 新增可选换源 arg | 出口本身不可达时的逃生口；缺省空 = 行为不变 |
| `Dockerfile` | build 阶段 `RUN`（原 `apt-get … zip && pnpm install …`） | 加 `--mount=type=cache`（apt 缓存/索引、pnpm store）+ `Acquire::Retries=6` + 外层 3 次重试；`pnpm install` 也套重试 | 断链可恢复；重跑命中本地缓存 |
| `Dockerfile` | runtime 阶段 `RUN`（原失败行） | 同上（apt/pip/npm/corepack 全部套重试，pip 另加 `--retries 10`）；cache mount：`/var/cache/apt`、`/var/lib/apt/lists`、`/root/.cache/pip`、`/root/.npm`；删除 `rm -rf /var/lib/apt/lists/*` 与 `npm cache clean --force` | 失败行可自愈；下载物跨构建复用且**不进镜像层** |
| `docker-compose.yml` / `docker-compose.super.yml` | `build:` 段 | `build: .` → `build.context + args.DEBIAN_MIRROR: ${DEBIAN_MIRROR:-}` | `.env` 一行即可换源，无需改 Dockerfile |
| `deploy/env.production.example` | 宿主参数块之后 | 新增注释段 `DEBIAN_MIRROR=`（可选，仅构建期） | 换源入口在部署模板里可见 |

关键设计取舍（均为实测结论，不是推断）：

- **cache mount 内容不进镜像层**，所以原收尾的 `rm -rf /var/lib/apt/lists/*` 必须删——留着会把
  索引缓存每次构建都清空；`npm cache clean --force` 同理（它会清掉挂载里的缓存）。
- **不能整体挂 `/root/.cache`**：corepack home 在 `/root/.cache/node/corepack`，
  `corepack prepare pnpm@11.7.0 --activate` 的产物必须留在镜像层。实测整体挂载后镜像内
  `pnpm --version` 变成去下 `12.21.0`（钉版失效）→ 改为只挂 `/root/.cache/pip`，
  修复后断网实测 `pnpm --version` = `11.7.0`（`image-assertions.txt`）。
- 重试函数 fail-closed：3 次都失败 → `[build] FATAL retry exhausted` + 退出码 1，
  **不会静默吞错**（`retry-helper-cases.txt` CASE A）。

## 3 验证（命令原文/EXIT 见 `cmd.log`）

| # | 断言 | 命令 | 结果 |
|---|---|---|---|
| 1 | Dockerfile 语法/最佳实践 | `docker build --check .` | `Check complete, no warnings found.` EXIT=0（改动前后各一次） |
| 2 | 失败的 apt 包清单本可装 | 原包清单 `apt-get install` 复跑 | EXIT=0，28s（`repro-apt-install.txt`） |
| 3 | 修好的 runtime `RUN` 从零可过 | scratch 阶段 `--no-cache` 冷跑同一条 RUN 文本 | EXIT=0，60.2s，探针全过（`scratch-runtime-stage-cold.log`） |
| 4 | 完整镜像可构 | `docker build -t eterna-agent:rc5-p5-repair .`（两次：`full-build.log`、最终状态 `full-build-final.log`） | 均 **EXIT=0**。首次 `#4 CACHED`（runtime `RUN` 命中第 3 项冷跑产出的同一条命令层）；最终一次 `#12 CACHED`（注释变更不改命令哈希）、`#10 [build 6/7]` build 阶段 RUN **实跑 11.9s**（cache mount 命中 pnpm store） |
| 5 | 镜像内断言（全部断网 `--network=none`） | `--entrypoint sh …` 断言集 | dsh `0.2.2-rc.5`；pnpm `11.7.0`；python docx/openpyxl/pptx 可 import；Noto CJK 10 项；flock 在；entrypoint 可执行；v1（core/、basis.yml、6 包）absent；apt/npm/pip 缓存**无泄漏**（`image-assertions.txt`） |
| 6 | compose 构建链 | `docker compose -f docker-compose.yml build` | EXIT=0 `Image … Built`（`compose-build.log`） |
| 7 | compose 变量解析 | 两份 `docker compose config` | 均 EXIT=0，`DEBIAN_MIRROR: ""` |
| 8 | 重试语义 | CASE A/B/C | 1/0/0（`retry-helper-cases.txt`） |
| 9 | 换源 sed 逻辑 | 用 `https://mirrors.aliyun.com` 跑同一段 sed | `URIs: https://mirrors.aliyun.com/debian` + `/debian-security`（cmd.log #9） |
| 10 | npm 11 阻断 install script 是否致命 | 镜像内 `require('koffi')` + `node-pty.spawn()` | koffi 3.1.1 load OK；node-pty 真实 spawn 输出 `hi`（cmd.log #10）——prebuilt 生效，warning 无害 |

**未验证**：

- 没有在「真实断链」条件下演练（无法注入故障）：用坏源对照证明 `Acquire::Retries` 生效 + 重试函数三例单测近似覆盖。
- 没有做整链 `--no-cache` 全量重建（成本高且与失败行无关）：冷跑只覆盖 runtime `RUN`。
- `docker compose build` 走的是同机 buildx（Docker 29.7.2 / buildx 0.36.0，`desktop-linux`）；
  **cache mount 需要 BuildKit**，`DOCKER_BUILDKIT=0` 的旧构建器不支持（新版 Docker 已移除 legacy builder）。

## 4 复跑指引

```bash
cd /Users/sunny/code/agent-basis-rc5
docker compose build          # 或 docker build -t <tag> .
# 若出口仍打不通 deb.debian.org（重试也救不回）：
DEBIAN_MIRROR=https://mirrors.aliyun.com docker compose build
```

## 5 遗留（详见 LaneReport.leftovers）

1. 镜像体积 3.92 GB：`/usr/local/lib/node_modules` 1.3 G + `/repo/node_modules` 884 M + `/usr/share/fonts` 94 M
   （`image-assertions.txt` 同批实测）。与本次修复无因果关系（cache mount 已实测无泄漏），但值得单独一轮瘦身。
2. 完整构建里 runtime `RUN` 一直是层缓存命中（首次 `#4 CACHED`、最终 `#12 CACHED`），它的真实执行证据是第 3 项冷跑。
   若主线要求「零缓存全链」留档，请用 `docker build --no-cache` 再跑一次（约 10+ 分钟）。
3. npm 11 的 `allowScripts` 默认阻断 5 个 install script（koffi/node-pty 等）；本镜像实测运行正常，
   但**若上游改为「必须编译」的包**，这条 warning 会变成运行期故障——建议基镜像升级时复查。