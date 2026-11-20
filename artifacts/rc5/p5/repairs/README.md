# P5 · W4 基座门禁修复（镜像探针 + compose config）

- 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`）
- 时间：2026-11-20（第 1 轮）
- 边界：未 `git push/merge`；未停/改生产容器；未碰 `/Users/sunny/code/agent-basis` 与 deepseek-harness；
  未改 `packages/**`；未用 reset/clean/stash/全量 checkout。

## 1 结论（两条独立根因）

### 1.1 四个镜像探针全被 entrypoint 的密钥断言拦死

门禁的 `dsh --version` / `node -v` / `v1 stripped` / `fonts/python` 四节都只输出
`/app/entrypoint.sh: 36: MIMO_API_KEY: MIMO_API_KEY required …`。原因是 `docker/entrypoint.sh`
在**任何**调用形态下都先执行第 36 行的硬断言：

```
docker/entrypoint.sh:36  : "${MIMO_API_KEY:?MIMO_API_KEY required (env / compose .env——默认模型走 MiMo 直连)}"
```

而 `docker run <img> <cmd>` 会走镜像自带 ENTRYPOINT，探针既没传 key、也不该需要 key。
于是四节探针的退出码全部是 2，断言零可达——这是门禁全红的第一因，与镜像内容无关。

**修复**：`docker/entrypoint.sh:36-55` 增加「直接命令模式」分派（位置在 MIMO 断言之前）：

- 首个参数以 `-` 开头 = dsh 旗标，**保持历史语义**（继续走完整启动链，末尾 `exec dsh "$@"`）；
- 否则视为显式命令：`exec "$@"`，不渲染 profile、不碰 `/data`、不要求 MIMO_API_KEY；
- 单 argv 内含空格（`"dsh --version"` 整条当一个参数）时按 `sh -c "$1"` 解释，两种引号习惯都可达。

生产路径零变化：两份 compose 都没有 `command:` 行（`grep -n "command:" docker-compose*.yml` 无输出），
容器无参数启动时 `$# = 0` → 落到 MIMO 断言 → 原链路不变（反向对照见 §3）。

### 1.2 compose 三份 config 因 `ETERNA_DATA_ROOT:?` 硬必填而报错

门禁的 `compose config` / `super config` / `acp config` 三条都报
`required variable ETERNA_DATA_ROOT is missing a value`。数值来自 T43 的
`${ETERNA_DATA_ROOT:?…}`（`docker-compose.yml:87`、`:126`、`docker-compose.super.yml:68` 修复前）。

但仓库自身口径是矛盾的：`docker-compose.yml:6` 写「缺省 `$HOME/eterna-data`」，
`deploy/README.md:53` 同样写缺省 `$HOME/eterna-data`，`deploy/init-data-dirs.sh:5`、
`deploy/backup-data.sh:26` 也都用 `${ETERNA_DATA_ROOT:-$HOME/eterna-data}`——只有 compose 硬必填，
导致**任何没有 .env 的 config 校验都不可能通过**。

**修复**：三处卷行改为 `${ETERNA_DATA_ROOT:-$HOME/eterna-data}/${ETERNA_INSTANCE:-…}:/data`
（`docker-compose.yml:92`、`:132`、`docker-compose.super.yml:72`），与仓库其它入口的缺省口径对齐。
代价与兜底（明写在 compose 注释与 `deploy/README.md`）：

- 不再对 `up` 报「缺变量」——缺省落 `$HOME/eterna-data`（**不是**仓库目录，T43 的原始担忧仍成立）；
- 「`/data` 没挂上」仍由 entrypoint 的 mountpoint 预检 fail-closed 拒启；
- 生产仍建议在 `.env` 显式设绝对路径（文档已改口径，不再是「必填/报错」）。

## 2 改动文件

| 文件 | 位置 | 改动 |
|---|---|---|
| `docker/entrypoint.sh` | `:36-55`（新增，位于 `:57` 的 MIMO 断言之前） | 直接命令模式分派（含单 argv 带空格的 `sh -c` 兜底） |
| `docker-compose.yml` | `:19`（头注）、`:92`（web /data）、`:132`（acp /data） | `:?` → `:-$HOME/eterna-data` |
| `docker-compose.super.yml` | `:8`（头注）、`:72`（/data） | 同上（实例缺省 `super-2` 不变） |
| `deploy/README.md` | `:35-39`（数据根口径）、`:211`（故障表一行） | 从「`:?` fail-closed / 必填报错」改为「缺省 `$HOME/eterna-data`」 |
| `deploy/env.production.example` | 数据根注释段 | 同上口径；`ETERNA_DATA_ROOT=/Users/sunny/eterna-data` 示例值不变 |

`Dockerfile` 本轮未改（上一轮网络韧性修复保持原样）；`scripts/**` 未改（门禁脚本不在本仓，
`grep -rn "v1 stripped" scripts tests` 无命中）。

## 3 验证（命令原文/EXIT 见 `cmd.log` 与各证据文件）

| # | 门禁项 | 命令（关键） | 结果 |
|---|---|---|---|
| 1 | dsh --version | `docker run --rm <img> dsh --version` | `0.2.2-rc.5` **EXIT=0** |
| 2 | node -v | `docker run --rm <img> node -v` | `v24.22.3` **EXIT=0** |
| 3 | v1 stripped | `docker run --rm <img> sh -c 'test ! -e /repo/core …'` | `v1 stripped OK` **EXIT=0** |
| 4 | fonts/python | `docker run --rm <img> sh -c 'python3 -c "import docx,openpyxl,pptx" … fc-list …'` | python + Noto CJK/Liberation/DejaVu 全 OK **EXIT=0** |
| 5 | 引号另一种形态 | `docker run --rm <img> "dsh --version"` | `0.2.2-rc.5` **EXIT=0** |
| 6 | compose config | `env -u ETERNA_DATA_ROOT docker compose -f docker-compose.yml config` | **EXIT=0**，`source: /Users/sunny/eterna-data/super` |
| 7 | compose super config | `env -u ETERNA_DATA_ROOT docker compose -f docker-compose.super.yml config` | **EXIT=0**，`source: …/eterna-data/super-2` |
| 8 | compose acp config | `env -u ETERNA_DATA_ROOT docker compose -f docker-compose.yml --profile acp config` | **EXIT=0**，3 服务，web 与 acp 同根 |
| 9 | 显式覆写仍生效 | `ETERNA_DATA_ROOT=/srv/alt … config` | `source: /srv/alt/super` **EXIT=0** |
| 10 | 生产链路未被放开 | `docker run --rm <img>` / `… --profile eterna-web` | 两条都仍 `MIMO_API_KEY required` **EXIT=2** |
| 11 | 镜像内容回归 | 断网 `--entrypoint sh` 断言集 | dsh/pnpm 11.7.0/node/flock/entrypoint 可执行/koffi 3.1.1/无 apt·npm·pip 缓存泄漏 **EXIT=0** |
| 12 | 八项整体重放（1–8 + 反向） | 见 `gate-replay.txt` | 八个门禁项全 EXIT=0；反向对照 EXIT=2（`gate-replay.txt`） |

**未验证 / 说明**：

- 没有启动带密钥的完整容器（会起服务、动 /data）：生产启动链只做了「缺 key 即拒启」的反向对照，
  未验证正常启动后的行为——但本轮没有改动 `$# = 0` 之后的任何代码路径（diff 可核）。
- 门禁脚本本体不在本仓（`grep -rn "v1 stripped|compose acp config" scripts tests` 无命中），
  因此是按「门禁输出里的四节标题 + 报错原文」逐条复现，不是执行门禁脚本本身。
- 镜像为重建后的 `eterna-agent:rc5-p5-repair`（`docker build` **EXIT=0**，见 `image-build.log`）。

## 4 遗留

1. `docs/design/48-容器数据持久化目录改造方案.md:224,325,332,339` 与 `50-…:658` 仍写
   `${ETERNA_DATA_ROOT:?…}`，与现实现不一致（docs/design 不在本 lane 白名单，未改）。
2. 「缺省/必填」口径先前在同一仓库内自相矛盾（头注写缺省、卷行写必填），本轮已统一为缺省；
   若产品上确需「无 .env 即拒启」，那需要门禁侧先给 config 校验传 env，否则二者不可同时满足。