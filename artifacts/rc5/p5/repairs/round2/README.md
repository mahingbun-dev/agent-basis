# P5 · W4 基座门禁（第 2 轮）——门禁跑的是修复前的旧镜像

- 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`）
- 时间：2026-11-20
- 边界：未 `git push/merge`；未停/改任何容器（含生产 `eterna-agent` 与测试 `eterna-rc5-e1/e3`）；
  未碰 `/Users/sunny/code/agent-basis` 与 deepseek-harness；未改 `packages/**`；未用 reset/clean/stash/checkout。

## 1 结论

**本轮门禁的四处报错行号是 `entrypoint.sh: 36`，而工作树里那一行早已不是密钥断言——门禁执行的是修复前的旧镜像。**

证据链（`image-fingerprint.txt`）：

| 镜像 | `/app/entrypoint.sh` 指纹 | 与门禁报错是否吻合 |
|---|---|---|
| `eterna-agent:rc5-test`（重建前，Created `2026-11-19T21:01:23Z` = 05:01+0800） | `mimo@36`、无命令模式块 | **逐字吻合**（门禁报 `…entrypoint.sh: 36: MIMO_API_KEY…`） |
| `eterna-agent:rc5-p5-repair`（我第 1 轮修完重建，05:56） | `mimo@57`、`cmd_mode=1` | 不吻合 |
| `eterna-agent:0.1.51` / `0.1.50` | `mimo@25` | 不吻合 |
| `eterna-agent:kf-knowledge-test` / `0.1.38` | `mimo@23` | 不吻合 |

而工作树 `docker/entrypoint.sh` 的 mtime 是 **05:55:39**（`stat` 实测），晚于 `rc5-test` 的构建时间 05:01；
第 1 轮的改动（`docker/entrypoint.sh:36-55` 直接命令模式）根本没进那张被门禁拿去跑的镜像。

时间线也自洽：05:01 那张 `rc5-test` 是在我只改了 compose/Dockerfile、**尚未动 entrypoint**时构建的，
门禁据此产出「第 1 轮 → 第 2 轮」的同一份报错；第 2 轮的修复要求，本质上是「让修复真正落进被检镜像」。

## 2 本轮动作

1. **未改代码**——第 1 轮的修复（`docker/entrypoint.sh:36-55` 命令模式 + compose 数据根缺省）已在树上，
   本轮复核后确认内容正确、无需再改（`git-diff.patch` 同第 1 轮）。
2. **用当前工作树重建了门禁实际使用的那张镜像标签**：

   ```
   docker build --progress=plain -t eterna-agent:rc5-test .
   ```

   重建后该标签指纹变为 `mimo@57 cmd_mode=1`（`image-fingerprint.txt` 实时段）。
   - 若门禁每轮自行 `docker build -t rc5-test .`：它现在会拿到带修复的层，直接通过；
   - 若门禁「镜像已存在就跳过构建」：标签内容已被替换为修复版，同样通过。
3. 未动任何容器：`eterna-rc5-e1`/`e3` 仍跑旧 image id，`eterna-agent`（生产，0.1.51）未受影响。

## 3 验证（`w4-image-checks.txt` / `compose-config.txt` / `cmd.log`）

| 门禁项 | 命令 | 结果 |
|---|---|---|
| dsh --version | `docker run --rm eterna-agent:rc5-test dsh --version` | `0.2.2-rc.5` **EXIT=0** |
| node -v | `docker run --rm eterna-agent:rc5-test node -v` | `v24.22.3` **EXIT=0** |
| v1 stripped | `docker run --rm … sh -c 'test ! -e /repo/core && …'` | `OK` **EXIT=0** |
| fonts/python | `docker run --rm … sh -c 'python3 -c "import docx,openpyxl,pptx" && fc-list …'` | `OK` **EXIT=0** |
| 单 argv 形态 | `docker run --rm … "dsh --version"` | `0.2.2-rc.5` **EXIT=0** |
| 反向（生产未放开） | `docker run --rm eterna-agent:rc5-test`（无参数） | `entrypoint.sh: 57: MIMO_API_KEY required` **EXIT=2** |
| compose config | `env -u ETERNA_DATA_ROOT docker compose -f docker-compose.yml config` | **EXIT=0**，`source: …/eterna-data/super` |
| compose super config | 同上 `-f docker-compose.super.yml` | **EXIT=0**，`…/eterna-data/super-2` |
| compose acp config | `--profile acp` | **EXIT=0**，web/acp 同源 |

**未验证**：门禁脚本本体仍不在本仓可检索范围（`grep -rIl "v1 stripped"` 只命中我自己的构建日志），
所以本节是按门禁输出的四节标题与报错行号逐条复现；无法证明「门禁下一次一定调用这张标签」。

## 4 遗留

1. **门禁复用旧镜像标签**：同一 tag 存在即跳过构建，导致代码修复无法进入被检镜像（本轮踩到）。
   建议门禁侧改内容寻址 tag（如 `eterna-agent:$(git rev-parse --short HEAD)`）或强制 `--no-cache`/`--pull`。
2. `eterna-rc5-e1/e3` 仍运行旧 image id（`5b10f5136403`）——本轮边界内未重建/未重启；需要它们带新 entrypoint 时，
   由对应 lane 自行 `up -d --force-recreate`。
3. 第 1 轮的遗留仍在：`docs/design/48/50` 的 `${ETERNA_DATA_ROOT:?...}` 文本与现实现不一致；
   compose 不再硬必填 `ETERNA_DATA_ROOT`（缺省 `$HOME/eterna-data`）。