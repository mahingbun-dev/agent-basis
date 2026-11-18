# 40 - super 形态与门禁开发文档（模板拆分 × ETERNA_FORM × form-check × 双 boot 门禁入 CI）

> 状态：**开发文档（实现规格）**。承接已定稿设计（31 号、33 号），本文不含新设计决策；设计未覆盖、需实现选择的点全部收入 §9 开放问题并标【暂定】（"按建议暂定，如有异议随时改"，31 号 §5 同款纪律），未拍板前不得视为定稿行为。
> 规格来源：`31-双形态治理-仓库发布迭代与容器切换.md` §2.1/§2.2/§2.5/§4/§6（模板拆分 / compose / ETERNA_FORM / 守卫式 symlink / verify-super / super-bundle）· `33-开发总工作流与门禁.md` G0-6/G1-1/G1-2/G2-A11/G3-M1③/G4-4/G4-7/§4/§5/§6 缺口 1·13（packctl form-check 子命令、双 boot 门禁进 CI 的命令实现）。
> 关联：`24a-融合设计决策速览.md`（拍板事实源）· `32-最终态开发方法`（里程碑 M1 时点）· 现有工程：`docker/entrypoint.sh`、`docker-compose.yml`、`docker/profile/cordis.patch.yml.template`、`profiles/eterna-web/cordis.patch.yml`、`scripts/verify-eterna-web.mjs`、`tools/packctl/src/cli.ts`、`.github/workflows/ci.yml`、`scripts/build-market.mjs`、`market/index.json`。
> 日期：2026-11-17。文中"本日实测"均为 2026-11-17 在本仓库执行所得，命令随注。

---

## 0. 一句话结论

super 形态不是第二个代码库，是**同一单镜像内的第二份 patch 模板 + 第二份 compose + 一个环境变量分派**（31 号 §0/§2.5）；本文把这五件装配物与两条新门禁（G0-6 form-check、G1-2 verify-eterna-super）落成 9 个可验收任务，全部两列可追溯（依据条款 / 验收门禁），不新增 33 号体系之外的任何门禁编号。

---

## 1. 现实基线（本日实测，2026-11-17）

| # | 事实 | 实测命令 / 位置 |
|---|---|---|
| 1 | entrypoint 现为单模板单清单：`ensure_rendered` 只渲染 `cordis.patch.yml.template`（docker/entrypoint.sh:120-121）；第 3 步 `@eterna` symlink 硬编码 11 包清单（glue / llm-doctor / brand / panel / prompt-studio / llm-openai / access / usage-stats / compaction / attachments / memory）+ 1 条 creation-skills 别名 | `docker/entrypoint.sh:173`（sed -n '173p' 逐字核对） |
| 2 | 全仓无 `ETERNA_FORM` 出现；`docker-compose.yml` 单服务：端口 3210:8080 与 9310:9310、卷 `eterna-home`、模板只读挂载 | `grep -rn "ETERNA_FORM" --include='*.sh' --include='*.mjs' --include='*.yml' .`（排除 node_modules）0 命中；`docker-compose.yml:21,25,28,48,53` |
| 3 | `packctl --help` 无 form-check 子命令（现有 5 个子命令：init/lint/check/tenant-scan/prompt-scan） | `node tools/packctl/bin/packctl.mjs --help`（退出码 0，输出逐字） |
| 4 | `scripts/` 下无 verify-eterna-super.mjs；`docs/tiers.yml` 不存在 | `ls scripts/ | grep -i super` 无输出；`ls docs/tiers.yml` → No such file |
| 5 | `.github/workflows/ci.yml` 无任何 G1 类步骤、无 schedule 触发（实测 `grep -c "schedule"` = 0）；两 job（verify :9 / upgrade-gate :46）均由 push[main,dev]+PR 触发 | `.github/workflows/ci.yml:3-6` |
| 6 | **base 形态两份工件已实质漂移**：容器模板 insert 挂载行 18 条，开发档挂载清单 `profiles/eterna-web/cordis.patch.yml` 仅 7 条；模板独有的 11 条为 directory-picker-host + eterna-access/audit/brand/egress/governance/knowledge/llm-doctor/memory/panel/usage-stats（治理三件套、access、面板等生产挂载行） | `grep -c "^    - id:" 两文件` = 18 / 7；集合 diff 见 §9 Q1 |
| 7 | Tier1 候选真值：`packages/`（29 个，`bundle-core/` 无 package.json 不算包）+ `tools/`（packctl / evals / eterna-smoke 3 个）共 32 名；其中 30 名带 verify 脚本（33 号 §0"30 个包"为 verify 链口径） | `ls packages/*/package.json tools/*/package.json \| wc -l` = 32；`grep -rl '"verify"' … \| wc -l` = 30 |
| 8 | Tier2 目标包 tasks / workbench / toolkit 均未落地（`packages/` 无此目录）；channels / interact 已存在但不在生产挂载面（24 号 G4"已建未挂"） | `ls packages/`（30 目录逐字） |
| 9 | verify-eterna-web.mjs 的模式可复制：CUT_ROWS（:50-67）/ HOST_KEPT_ROWS（:70-110）/ PRESET_KEPT_ROWS（:113-120）三张行表 + 真 boot（:216）+ pluginInventory 活体断言（:262 起）+ 浏览器花名册取证（:344-373）；无凭据、无模型调用，OS 随机端口（`--port 0`） | `scripts/verify-eterna-web.mjs` 头注与行号 |

---

## 2. 范围与非目标

**范围**：31 号 §6 实施清单 1–3 的全部装配物与门禁命令（模板拆分、`docker-compose.super.yml`、entrypoint `ETERNA_FORM`、守卫式 symlink、`verify-eterna-super.mjs`、`packctl form-check` + `docs/tiers.yml`）、双 boot 门禁与 form-check 进 CI（33 号 §5 矩阵【待建】列、§6 缺口 13）、M1 基线落盘（G3-M1 ③）、super-bundle 产物登记（31 号 §6-4，后置）。

**非目标**（不在本文、不得顺手做）：

1. tasks / workbench / toolkit / channels 生产挂载的**行内容本身**——分别属 WS-A/WS-D/WS-B/WS-E（33 号 §1.3、§4 依赖表）；本文只提供"挂一行就能被门禁看见"的装配面；
2. G4 发布层门禁（双 tag、CHANGELOG、upgrade-gate）——已登记于 33 号 §1.5，本文不重复定义；
3. 前端 / 交互实现——本批 9 任务改动面为容器装配、CLI、CI、脚本，无任何 `packages/*/client`、slots、UI 文案改动（判定与指针见 §5）；
4. `verify-eterna-web.mjs` 改名 `verify-eterna-base`——31 号 §4-2 明示"改名可选"，本文**不改名**（最小扰动；S-8 基线与 G3-M1 ③ 均按现名执行）。

---

## 3. 任务总览（两列可追溯）

| # | 任务 | 依据条款 | 验收门禁（可执行） | 类型 | 时机 |
|---|---|---|---|---|---|
| S-1 | `docs/tiers.yml` Tier 真值源（tier1=现有 32 名 / tier2=tasks、workbench） | 33 号 G0-6 ①；31 号 §2.2 | `node tools/packctl/bin/packctl.mjs form-check`（真值源加载即被校验，缺失/不可解析→退出码 2）；`grep -A3 "^tier2:" docs/tiers.yml` 含 tasks、workbench | 【C】 | WS-A 启动第一批；硬性截止=tasks 包落地 PR 合并前 |
| S-2 | `packctl form-check` 子命令（TIER001/FORM001 四则判定） | 33 号 G0-6（四则原文）、§6 缺口 1；31 号 §4-1/§6-3 | `pnpm --filter @eterna/packctl run verify`（含 `tools/packctl/tests/form.spec.ts` 四类红绿用例）；`node tools/packctl/bin/packctl.mjs form-check` 退出 0；`node tools/packctl/bin/packctl.mjs --help \| grep form-check` 有输出 | 【T】【C】 | 同 S-1 |
| S-3 | super 模板 `docker/profile/cordis.super.patch.yml.template` + 挂载清单 `profiles/eterna-super/cordis.patch.yml`（初始=base 挂载面的壳） | 31 号 §2.1/§2.5（模板行）、§6-1；33 号 G2-A11 ① | `test -f docker/profile/cordis.super.patch.yml.template && test -f profiles/eterna-super/cordis.patch.yml`；form-check 的 FORM001 分支（含 base⊆super 超集断言）；`node scripts/verify-eterna-super.mjs` 退出 0 | 【C】 | WS-A 启动时（31 号 §6-1"super 需要可启动的壳"） |
| S-4 | `docker-compose.super.yml`（3220 / eterna-super-home / ETERNA_FORM=super / 并存相容） | 31 号 §2.5（compose/端口/数据卷行）、§5 D2；33 号 G4-7 | `docker compose -f docker-compose.super.yml config --quiet`；`grep -c "3220:8080" docker-compose.super.yml` ≥1 且 `grep -c "eterna-super-home" …` ≥1；负向 `grep -cE '"3210:8080"|"9310:9310"' docker-compose.super.yml` =0；`git diff main -- docker-compose.yml` 输出为空 | 【C】 | 同 S-3 |
| S-5 | entrypoint `ETERNA_FORM` 分派 + 守卫式 symlink + 哈希门控原样复用 | 31 号 §2.5（选择行/哈希门控）、§3、§6-1；33 号 G2-A11 ① | 容器内渲染探针（G2-A11 原文形态）：`docker compose -f docker-compose.super.yml up -d --build` 后断言 ①super 容器卷内挂载行集=super 模板；②base 容器 `ls /data/profiles/eterna-web/node_modules/@eterna/` 不含 Tier2 名；③ETERNA_FORM 未设时 base 渲染与现状一致（哈希门控重启用例） | 【C】 | 同 S-3 |
| S-6 | `scripts/verify-eterna-super.mjs`（复制 verify-eterna-web 模式） | 33 号 G1-2、§6 缺口 1、G2-A11 ②；31 号 §4-2/§6-2 | `node scripts/verify-eterna-super.mjs` 退出 0（真 boot：无 failed、CUT_ROWS 同 base 口径 inactive、super 挂载行集全部 active、无同 id 冲突、日志无 skipping/incompatible、花名册取证） | 【C】 | 同 S-3 |
| S-7 | CI 增补：verify job 加 form-check + 双 boot 三步；新增每日 schedule job | 31 号 §4-2；33 号 §5 矩阵说明、§6 缺口 13、G4-4 | `grep -cE "form-check\|verify-eterna-super\|schedule" .github/workflows/ci.yml` ≥3；本地同款三命令预演互证（G4-4：本地绿+CI 红不许硬并）；push 后 CI 两 job 绿 | 【A】【C】 | 同 S-3；schedule 生效不晚于 M1 收口 |
| S-8 | M1 基线落盘 `docs/baselines/verify-eterna-web-m0.txt` + 收口 diff | 33 号 G3-M1 ③、§6-15 | 落盘：`node scripts/verify-eterna-web.mjs > docs/baselines/verify-eterna-web-m0.txt`（WS-A 启动前）；M1 收口：`node scripts/verify-eterna-web.mjs \| diff docs/baselines/verify-eterna-web-m0.txt -` 退出 0（stdout 全量 diff，G3-M1 ③ 原文口径） | 【A】 | 落盘=WS-A 启动前；diff=M1 收口 |
| S-9 | market `super-bundle` 产物登记（承接 G2-A20，不重新定义） | 31 号 §2.1/§6-4；33 号 G2-A20、§4 表 | `node scripts/build-market.mjs && grep "super-bundle" market/index.json`（有输出；G2-A20 原命令） | 【C】 | M5（tasks 可用后；31 号 §6-4 后置） |

> 任务级验收命令（grep 计数、diff 为空等）是**任务验收**，不进 G0–G4 编号体系；本文不新增 33 号已登记之外的门禁（§6 映射声明）。

---

## 4. 各任务实现规格

### S-1 Tier 真值源 `docs/tiers.yml`

**改动落点**：新文件 `docs/tiers.yml`。

**内容**：

```yaml
# Tier 真值源(33 号 G0-6 ①):form-check 的唯一事实源,新包落地时登记。
# tier1 条目必须实际存在(不存在 → form-check 退出码 2 用法错误);
# tier2 允许登记未落地包(登记先于落地:tasks、workbench 为 31 号 §2.2 点名的 Tier2)。
tier1:
  - access        # …… packages/ 29 名逐个列出(access…usage-stats,以创建时 ls 为准)
  - packctl       # …… tools/ 3 名:packctl、evals、eterna-smoke
tier2:
  - tasks
  - workbench
```

- 初始 tier1 = 本日实测 32 名（`packages/` 29 + `tools/` 3，§1 表第 7 行；`packages/bundle-core/` 无 package.json 不算包）。逐名列出、不用通配——真值源必须显式（G0-6 ①"tier1/tier2 包名清单"）。
- toolkit **不在初始清单**：G0-6 ① 原文初始 Tier2 = tasks、workbench，toolkit 属"新包落地时登记"（其归属与 D1 暂定"base 可选挂载"的关系见 §9 Q5）。

| 项 | 内容 |
|---|---|
| 依据条款 | 33 号 G0-6 ①（真值源定义与初始名单）；31 号 §2.2（Tier 分级）；§1 表第 7 行（32 名实测） |
| 验收门禁 | 【C】`node tools/packctl/bin/packctl.mjs form-check`（S-2 交付后加载并校验本文件）；【C】`grep -A3 "^tier2:" docs/tiers.yml` 输出含 tasks、workbench |

### S-2 `packctl form-check` 子命令

**改动落点**：新 `tools/packctl/src/form.ts`；`tools/packctl/src/cli.ts` 接线（`case 'form-check'` + USAGE 增一行，cli.ts:22-31/67-84 同款形态）；新 `tools/packctl/tests/form.spec.ts`。

**判定四则**（逐条照 33 号 G0-6 原文，不增删）：

1. **Tier 真值源** = `docs/tiers.yml`；文件缺失 / YAML 不可解析 / tier1 条目在 `packages/`+`tools/` 下不实存 → **退出码 2**（用法错误，packctl 现有约定 cli.ts:5、:82-83；不新造错误码）。
2. **TIER001**：对每个 tier1 包的全部源码文件（`packages/<pkg>/**/*.ts|tsx|mts`，含 src、client 半边与 tests——G0-6 ②"包源码（src 与 client 半边）"的字面覆盖）做 import 静态扫描：`import … from`、`export … from`、`require()`、动态 `import()` 的说明符，解析后落到任何 tier2 包名（裸名 `@eterna/tasks` 或相对路径穿越包边界）→ 一处一 finding `ERROR TIER001 <file>`。
3. **FORM001**：base / super 各自的挂载清单与模板文件一致（比对口径【暂定，§9 Q1】：insert 块内 `@eterna` 挂载行 `id + name` **按序**逐行相等——与模板头注"重放挂载块"约定同源，`docker/profile/cordis.patch.yml.template:5-6`）；另加**超集断言**：base 模板挂载行集 ⊆ super 模板挂载行集（31 号 §2.1"base ⊕"语义的机器化）。任一不一致 → `ERROR FORM001 <file>`。
4. **Tier2 → Tier2 依赖不受约束**（31 号 §2.2 只约束 Tier1→Tier2）：不做检查、不告警。

**输出与退出码**：逐 finding 行 + 尾行汇总（tenant-scan 输出形态照抄 cli.ts:88-95）；有 finding → 退出码 1，全绿 → 0。

**测试用例**（`tests/form.spec.ts`，四类红绿）：

| 用例 | 构造 | 期望 |
|---|---|---|
| TIER001 红 | fixture 临时 tier1 包内写入 `import '@eterna/tasks'` | finding 含 TIER001，退出 1 |
| TIER001 绿 | 同 fixture 删该 import | 0 finding |
| FORM001 红 | fixture 一对清单/模板，挂载行漂移一行（增/删/换序各一例） | finding 含 FORM001，退出 1 |
| FORM001 绿 | 两文件挂载行按序一致且 base⊆super | 退出 0 |

| 项 | 内容 |
|---|---|
| 依据条款 | 33 号 G0-6（四则判定与错误码 TIER001/FORM001、退出码 0/1）、§6 缺口 1（本日实测无此子命令）；31 号 §4-1/§2.1（超集语义）；现有工程 cli.ts:22-31/:67-95（子命令与输出惯例） |
| 验收门禁 | 【T】`pnpm --filter @eterna/packctl run verify`（oxlint + tsc strict + vitest，含 form.spec.ts）；【C】`node tools/packctl/bin/packctl.mjs form-check` 退出 0；【C】`node tools/packctl/bin/packctl.mjs --help \| grep form-check` 有输出 |

### S-3 super 模板与挂载清单

**改动落点**：新 `docker/profile/cordis.super.patch.yml.template`（容器档模板）；新 `profiles/eterna-super/cordis.patch.yml` + `profiles/eterna-super/README.md`（开发档挂载清单，目录形态照 `profiles/eterna-web/` 先例：README + patch 两文件）。

**内容纪律**：

1. **初始 = base 挂载面的壳**：super 模板/清单的初始内容 = base 对应文件原样（Tier2 挂载行为空集）。依据：31 号 §6-1 时机列"super 需要可启动的壳"+ §1 表第 8 行（tasks/workbench/toolkit 未落地，挂不存在的包必 boot failed）；channels/interact 的生产挂载行属 WS-E（26 号 §2 中改、33 号 G2-E1，M4），不在拆分时挂。
2. **挂载行随包落地加入**：tasks（WS-A/M1）、toolkit（WS-B/M2）、workbench（WS-D/M3）、channels+interact 接线（WS-E/M4）各自落地 PR **必须**同步改 super 模板与 super 挂载清单两处（FORM001 看护一致），并触发 G1-2 重跑。依据：33 号 §4 依赖表、§1.3 各 WS 里程碑列。
3. **裁切面继承**：super 不回加 base 裁切的行（遥测/账号/场景裁切等）——31 号 §2.1"base ⊕"是加法不是重定义；G1-2 的 CUT_ROWS 与 G1-1 同口径。
4. 模板头注逐条复制 base 模板的纪律段（密钥纪律 / 漂移守卫 / 补丁语义），并把"漂移守卫"对象改为 super 挂载清单。

| 项 | 内容 |
|---|---|
| 依据条款 | 31 号 §2.1（super=base⊕tasks+channels+interact+workbench+toolkit）、§2.5（模板一分为二）、§6-1；33 号 G2-A11 ①、§4 依赖表；`docker/profile/cordis.patch.yml.template:1-39`（头注纪律先例）、`profiles/eterna-web/`（清单目录先例） |
| 验收门禁 | 【C】`test -f docker/profile/cordis.super.patch.yml.template && test -f profiles/eterna-super/cordis.patch.yml`；【C】form-check FORM001 分支（S-2，含 base⊆super）；【C】`node scripts/verify-eterna-super.mjs` 退出 0（S-6，用本清单 boot） |

### S-4 `docker-compose.super.yml`

**改动落点**：新 `docker-compose.super.yml`（根目录，与 `docker-compose.yml` 并列）；**`docker-compose.yml` 一行不改**。

**内容**（逐项对 31 号 §2.5）：

| 项 | 值 | 依据 |
|---|---|---|
| 镜像 | `eterna-agent:<同一 tag>`（单镜像不变，D2 暂定） | 31 号 §2.5 镜像行、§5 D2 |
| 端口 | `"3220:8080"`（super 3220） | 31 号 §2.5 端口行 |
| 数据卷 | named volume `eterna-super-home`（与 `eterna-home` 分离永不互通） | 31 号 §2.5 数据卷行；33 号 G4-7 |
| 模板挂载 | `./docker/profile/cordis.super.patch.yml.template:/repo/docker/profile/cordis.patch.yml.template:ro`（挂到**同名路径**，entrypoint 按形态选文件——见 S-5；只读挂载形态照 base 先例 docker-compose.yml:53） | 31 号 §2.5 模板行；entrypoint 现状 :121 |
| env | `ETERNA_FORM: super`（其余 env 逐字复制 base 服务段：模型 key、access 播种、relay） | 31 号 §2.5 选择行；docker-compose.yml:29-46 |
| 并存相容 | 不得复用 base 已占的宿主端口与容器名：负向断言不含 `"3210:8080"`、`"9310:9310"`、`container_name: eterna-agent`。具体值【暂定 §9 Q3：宿主中继端口 9320（容器内 9310 不变，仅映射不同）、容器名 eterna-agent-super】 | 31 号 §2.5"切换=并存（两个 compose 项目同时跑）"；docker-compose.yml:21,25,28 |

**schema 前向守卫**（31 号 §2.5 切换语义行）已由 store 既有纪律承担（"新 schema 拒启，store 已有此纪律"原文），本文无新增实现；部署级"用 base 开 super 卷断言拒启"归 33 号 G4-7 发布门禁（`deploy/verify.sh` 两态口径），不在本批任务。

| 项 | 内容 |
|---|---|
| 依据条款 | 31 号 §2.5（compose/端口/数据卷/切换语义行）、§5 D2；33 号 G4-7；docker-compose.yml:17-58（base 服务段先例） |
| 验收门禁 | 【C】`docker compose -f docker-compose.super.yml config --quiet`；【C】`grep -c "3220:8080" docker-compose.super.yml` ≥1 且 `grep -c "eterna-super-home" docker-compose.super.yml` ≥1；【C】负向 `grep -cE '"3210:8080"|"9310:9310"' docker-compose.super.yml` =0 且 `grep -c "container_name: eterna-agent$" docker-compose.super.yml` =0；【C】`git diff main -- docker-compose.yml` 输出为空（PR 内执行；现网零改动，31 号 §2.5 compose 行） |

### S-5 entrypoint `ETERNA_FORM` 分派 + 守卫式 symlink

**改动落点**：`docker/entrypoint.sh`（第 2 步模板选择、第 3 步 symlink 清单、新增 `ETERNA_FORM` 读取；其余步骤 2.5 裁剪 / 2.6 治理规则 / 4 家族链接 / 4.5 relay / 5 启动**一行不改**——"哈希门控机制原样复用"原文）。【2026-11-18 补记】第 2 步渲染内部新增工坊托管值移植（`docker/profile/migrate-prompt-edits.mjs`，渲染前快照旧 patch、渲染后按基线判定移植 persona/section/maxBytes 共 6 条）——仍属第 2 步内部，其余步骤边界与"一行不改"清单不变；形态无关（base/super 共用同一脚本）。

**分派语义**：

1. `ETERNA_FORM` 缺省 = **base**。这不是新设计而是推导：31 号 §2.5 compose 行要求"docker-compose.yml 保持基座（现网 NAS 部署零改动）"，现网部署 env 无此变量（§1 表第 2 行实测全仓无 ETERNA_FORM），缺省必须与现状行为等价。
2. `ETERNA_FORM=super` → 模板换 `cordis.super.patch.yml.template`（S-4 已把它挂到镜像内同名路径，entrypoint 第 121 行的路径**不用改**，改的是"选哪份文件"）；profile 目录取独立目录【暂定 §9 Q2：`$DSH_HOME/profiles/eterna-super`，哈希文件 `.rendered.*.sha256` 随目录自然隔离】。
3. 非法值（非 base|super）处置【暂定 §9 Q4：fail-closed 拒启（exit 非 0 + 明确日志），与 §2.5"schema 前向守卫拒启"同款纪律；未拍板前本分支不得自行选择其他行为（如静默按 base 落）合入】。

**守卫式 symlink**（第 3 步改造，docker/entrypoint.sh:168-177）：

- 形态即清单：base 形态 = 现有 11 包清单 + creation-skills 别名（逐字保留）；super 形态 = base 清单 ⊕ super 模板挂载行新增的 `@eterna` 包（Tier2 及接线包落地即加入）。
- **守卫含义**：单镜像内 Tier2 源码始终在（D2），但 base 形态的 profile `node_modules/@eterna/` 物理上**不存在 Tier2 链接**——挂载面隔离落在 node_modules 解析层，对应 31 号 §3"base 的轻在于挂载面"与 §2.2 铁律 1（Tier1 永不 import Tier2）的装配对偶。
- 清单与模板的一致由 FORM001 看护（super 模板挂载行 ↔ super symlink 清单，S-2 判定则 ③ 的检查面【暂定 §9 Q1 含 entrypoint 清单在内】）。

| 项 | 内容 |
|---|---|
| 依据条款 | 31 号 §2.5（选择行"ETERNA_FORM=base\|super → entrypoint 选模板渲染（哈希门控机制原样复用）"）、§3、§6-1；33 号 G2-A11 ①（判据原文"ETERNA_FORM=super docker/entrypoint.sh 渲染探针（容器内自动）"）；docker/entrypoint.sh:37-121（哈希门控现状）、:168-177（symlink 现状） |
| 验收门禁 | 【C】渲染探针（容器内自动，本地预演命令）：`docker compose -f docker-compose.super.yml up -d --build` 后 ①`docker exec <super 容器> sh -c 'grep "^    - id:" /data/profiles/eterna-super/cordis.patch.yml'` 的 `@eterna` 行集 = super 模板挂载行集；②`docker exec eterna-agent sh -c 'ls /data/profiles/eterna-web/node_modules/@eterna/'` 不含任何 tier2 名（tasks 落地后此断言有区分度；现阶段空集断言命令仍须可执行、退出 0）；③ETERNA_FORM 未设：`docker compose up -d` 重启 base 容器，日志含"模板未变,保留用户文件"（哈希门控不回归，entrypoint:41 原文案） |

### S-6 `scripts/verify-eterna-super.mjs`

**改动落点**：新 `scripts/verify-eterna-super.mjs`（复制 `scripts/verify-eterna-web.mjs` 全模式：物化 profile → 真 boot 等 readiness 行 → pluginInventory 活体断言 → 浏览器花名册取证 → 有界停机）。

**与母本的差异点**（仅四处，其余逐字同源）：

1. `sourcePatch` = `profiles/eterna-super/cordis.patch.yml`；`profileName` = `eterna-super`【暂定 §9 Q2】；home 缺省 `<repo>/.eterna-super-home`（`ETERNA_PROFILE_HOME` 覆盖，verify-eterna-web.mjs:42 同款惯例；与 base 验证 home 隔离，互不污染）。
2. **super 挂载面断言**：挂载清单内全部 `@eterna` insert 行 present + enabled + **active**——行集从清单**派生**（挂一行、验一行），随包落地自动扩展；G1-2 判据原文"tasks/channels/workbench/toolkit 挂载行 active"即此断言在四包全部落地（M4）后的终态，不需要分阶段维护行表。
3. **无同 id 冲突**（G1-2 原文）：pluginInventory 快照内 entryId 无重复且 0 failed（母本 3a 断言天然覆盖 0 failed；重复 id 检查为新增一行遍历）。
4. CUT_ROWS / 宿主与预设保留行 / 花名册断言**原样继承**（super 裁切面=base，S-3 纪律 3）；"行序正确"（G1-2 原文）的机器口径【暂定 §9 Q6：行序由 FORM001 的按序比对静态看护，verify 侧只断言 active——两命令分工】。

**凭据纪律**：与母本同——无模型调用、无凭据、`--port 0`（母本头注 :6-8 承诺原样成立，CI 可跑）。

| 项 | 内容 |
|---|---|
| 依据条款 | 33 号 G1-2（"同 G1-1 口径，对 super 挂载面……无同 id 冲突、行序正确"+"复制 verify-eterna-web 模式"）、§6 缺口 1、G2-A11 ②；31 号 §4-2/§6-2；`scripts/verify-eterna-web.mjs`（模式母本，行号见 §1 表第 9 行） |
| 验收门禁 | 【C】`node scripts/verify-eterna-super.mjs` 退出 0；红路径自证（S-2 测试外的冒烟）：临时向 super 清单加一行不存在的包名 → 脚本退出 1（挂载行必 active 的负向证明，验完即还原） |

### S-7 CI 增补（form-check + 双 boot + 每日 schedule）

**改动落点**：`.github/workflows/ci.yml`——verify job 增 3 步 + 新增 schedule 触发的 job（33 号 §6 缺口 13 给出"verify job 加 G1 步骤或新增 cron job"两选项，本文暂定**双轨**：PR/push 面进 verify job、定时面独立 job【暂定 §9 Q8】）。

**verify job 新增步骤**（置于 `pnpm -w run verify` 之后，install 已就绪）：

```yaml
- name: 双形态依赖方向与挂载一致(form-check,G0-6)
  run: node tools/packctl/bin/packctl.mjs form-check
- name: eterna-base 真启动门禁(G1-1)
  run: node scripts/verify-eterna-web.mjs
- name: eterna-super 真启动门禁(G1-2)
  run: node scripts/verify-eterna-super.mjs
```

**新增每日 job**：`on: schedule`（cron 时点为实现自由度，任一固定时刻即可【暂定 §9 Q8，不构成行为设计】）触发与上面同款的三命令（每日双形态 boot 门禁——31 号 §4-2、32 号 §6 两条已定要求的落地）。

**互证纪律**（G4-4）：CI 步骤与本地命令**逐字同款**；本地绿 + CI 红先怀疑环境差异不许硬并，本地红就地修（`docs/upgrade-gate.md` §4 纪律原文承接）。

| 项 | 内容 |
|---|---|
| 依据条款 | 31 号 §4-2（"双 boot 门禁进 CI"）；33 号 §5 矩阵"每日（CI schedule）"列与说明段（"每 PR 是最低线"）、§6 缺口 13（现状实测无 G1/schedule）、G0-6 触发时机（form-check 落地后加入）、G4-4；`.github/workflows/ci.yml:3-6,9,46`（现状） |
| 验收门禁 | 【A】`grep -cE "form-check\|verify-eterna-super\|schedule" .github/workflows/ci.yml` ≥3（比对方式：计数）；【C】本地预演 `node tools/packctl/bin/packctl.mjs form-check && node scripts/verify-eterna-web.mjs && node scripts/verify-eterna-super.mjs` 退出 0；【C】push 后 CI verify job 绿（两 job 实测均每 push/PR 跑，33 号 §3 衔接表） |

### S-8 M1 基线落盘与 base 不受扰动 diff

**改动落点**：新目录 `docs/baselines/` + 文件 `docs/baselines/verify-eterna-web-m0.txt`（33 号 §6-15：`docs/baselines/` 为 33 号新设产物路径，首个交付物落地时创建）。

**两拍**：

1. **WS-A 启动前**：`node scripts/verify-eterna-web.mjs > docs/baselines/verify-eterna-web-m0.txt` 落盘（脚本无结构化输出，stdout 全量即基线——G3-M1 ③ 原文口径）。
2. **M1 收口**：重跑同命令 `| diff docs/baselines/verify-eterna-web-m0.txt -`，输出为空 = base 形态不受 WS-A 扰动证明。

| 项 | 内容 |
|---|---|
| 依据条款 | 33 号 G3-M1 ③（判据原文：基线路径、diff 为空、stdout 全量口径）、§6-15（产物路径新设约定） |
| 验收门禁 | 【A】`test -f docs/baselines/verify-eterna-web-m0.txt`；【C】M1 收口 `node scripts/verify-eterna-web.mjs \| diff docs/baselines/verify-eterna-web-m0.txt -` 退出 0 |

### S-9 market `super-bundle`（后置，承接不重定义）

**改动落点**：`market/super-bundle/` + `market/index.json` 条目 + `scripts/build-market.mjs` 构建清单扩展。

**纪律**：产物口径全部承接 33 号 G2-A20（format 1、`source: git` 固定 commit 指向包目录、build-market 一致性断言门禁 scripts/build-market.mjs:19-21 先例），本文不重新定义；**bundle 内容清单**（装哪些包）31 号 §2.1 只给产物名未给清单【§9 Q7，tasks 可用后定】。登记本任务是为让 31 号 §6 四件事在本文齐全，实施动作在 M5 窗口。

| 项 | 内容 |
|---|---|
| 依据条款 | 31 号 §2.1（super-bundle 产物名）、§6-4（时机"tasks 可用后"）；33 号 G2-A20（命令与判据原文）、§4 表（G2-A20 → M5） |
| 验收门禁 | 【C】`node scripts/build-market.mjs && grep "super-bundle" market/index.json`（有输出；G2-A20 原命令） |

---

## 5. 交互细节对照表

**判定：本批 0 条。** 依据：S-1～S-9 的改动落点全部为 YAML 配置、shell 脚本、CLI 工具、Node 验证脚本与 CI 工作流（§4 各任务"改动落点"逐条可查），无任何 `packages/*/client`、slots 注册、UI 文案、主题令牌、断点或 a11y 改动——不构成 24/26/27/28/29/30 号所拍板交互细节的实现位置。

super 挂载面未来承载的 UI，其已拍板交互细节与承接工作流如下（**指针，非本文对照表**——实现位置在各自工作流的开发文档登记）：

| 出处 | 已拍板交互细节（摘要） | 承接 |
|---|---|---|
| 30 号 §2/§2.1/§4/§7 | 工作台五视图一检查器、Canvas 渲染 + `getComputedStyle` 读 `--et-*` 双主题重绘、a11y 旁挂键盘可导航列表视图、200ms 合批 + 暂停 + 单工单回放（全局时间轴回放负向断言）、日志默认摘要行 + PII 过滤展开、面板只显示需要人的东西 | WS-D（G2-D3/D4/D8 等） |
| 24 号 §3/§7.2 | chat-demo 交互范式（流式块归并/纯函数投影）、侧栏状态点 + Attention 卡 + 结果回原对话三件事、移动端可用（640px 承接见 33 号 G2-D2） | WS-D |
| 29 号 §3/§7-4 | 模型设置页部署级能力矩阵（原生/借用/兜底/不可用四态）、矩阵无能力=UI 显式禁用态非静默消失 | WS-B（G2-B4/B5/B8） |
| 26/27/28 号 | 无 UI 拍板项（扩展模型/执行者/上下文策略均为机制层） | — |

若后续任务追加触碰上述任何一处，必须先补交互细节对照表再动工（铁律承接）。

---

## 6. 与 33 号门禁体系的映射（不新增编号声明）

| 本文任务 | 承接的 33 号门禁编号 | 备注 |
|---|---|---|
| S-1 + S-2 | G0-6（form-check） | 交付后 G0-6 从【待建】转正式，进入每 PR 必跑（33 号 §1.1 触发时机行） |
| S-6 | G1-2（verify-eterna-super） | 交付后 G1-2 从【待建】转正式；G1-1 用现名不改（§2 非目标 4） |
| S-7 | 33 号 §5 矩阵【待建】列（G0-6/G1-1/G1-2 的 CI 与每日落点）+ G4-4 互证 | 落地即关闭 §6 缺口 13 |
| S-8 | G3-M1 ③ | M1 收口判据的产物载体 |
| S-9 | G2-A20 | M5；判据原文承接 |
| S-4 卷分离 | G4-7 的构成部分 | 部署级断言（base 开 super 卷拒启）仍归 G4-7 发布门禁执行 |

按 33 号 §2.4 登记规约：本文**未新增**任何 G0–G4 门禁编号；§3/§4 中出现的 grep/diff/test 命令均为任务级验收，不进门禁体系。

---

## 7. 排期与依赖

```
WS-A 启动前:  S-8①(基线落盘——必须先于任何 WS-A 改动)
WS-A 启动第一批(可启动的壳,31 号 §6-1/2):
              S-3(模板+清单) → S-4(compose) → S-5(entrypoint) → S-6(verify-super) → S-7(CI)
              S-1+S-2(tiers.yml + form-check,硬性截止=tasks 包落地 PR 合并前,31 号 §6-3)
M1 收口:      S-8②(diff 为空)+ G3-M1 ②双绿
M5 窗口:     S-9(super-bundle)
```

- S-3→S-4→S-5→S-6 有序（后者以前者的产物为输入）；S-1/S-2 与 S-3～S-6 并行无依赖。
- S-7 依赖 S-2 与 S-6 产物存在（CI 步骤命令才可执行）。
- 每个落地 PR 的门禁：动挂载面 → G1-1 + G1-2 双跑（33 号 §1.2：动 Tier1 双跑、动 Tier2 只跑 G1-2）；git push 单独确认（AGENTS.md:26 沿用）。

---

## 8. 风险与回退

| 风险 | 表现 | 对策 / 回退 |
|---|---|---|
| form-check 出生即红（§1 表第 6 行：base 对漂移 11 行） | S-2 合入当天 FORM001 对 base 报 finding | 处置依赖 §9 Q1 拍板：或先做一次 base 对同步（11 行挂载行补进 profiles/eterna-web/cordis.patch.yml，随之 G1-1 断言面需同步扩——**这是行为变更，必须独立 PR + 双 boot 复跑**）；或 FORM001 首版范围按 Q1 拍板收窄。两条路都不得静默放红 |
| Tier2 未落地期间守卫断言空转 | S-5 验收门禁②现阶段断言集为空集 | 如实标注（§4 S-5 已注）；tasks 落地 PR 起有牙，G1-2 与该断言同窗生效 |
| CI 每 PR 多两个真 boot，时长上升 | verify job 变慢 | 33 号 §5 说明段"每 PR 是最低线"已授权条件触发（动 Tier1/挂载面时）；若实测超预算，按 §5 矩阵把 G1 步骤移每日 job + 合并前本地跑——调整属 CI 编排非门禁语义变更，须回写 33 号 §5 矩阵注 |
| 单镜像双模板被误改 | base 模板被 super 行污染 | FORM001 超集断言（base⊆super）+ S-8 基线 diff 双保险 |
| 模板挂载路径同名覆盖（S-4 把 super 模板挂到 base 模板路径名） | 两 compose 同时跑时镜像内路径二义 | 互斥由 compose 项目隔离保证（各自容器各自挂载面）；验收负向断言（S-4）保证宿主侧无端口/容器名冲突 |

---

## 9. 开放问题（设计缺口登记——未拍板前均为暂定建议，不构成定稿行为）

| # | 问题 | 现状证据 | 暂定建议（待拍板） |
|---|---|---|---|
| Q1 | **FORM001 比对口径 + base 对现存漂移**：33 号 G0-6 ③只说"一致"未定粒度；且 base 模板 18 条 insert 行 vs 开发档清单 7 条，模板独有 11 条（directory-picker-host 与 eterna-access/audit/brand/egress/governance/knowledge/llm-doctor/memory/panel/usage-stats）——治理三件套、access、面板的生产挂载行不在开发档清单 | §1 表第 6 行实测（2026-11-17：`grep -c "^    - id:"` = 18/7；集合 diff 逐行在案）；模板头注:5-6 自带的"sed 比对/重放挂载块"约定与现状脱节 | 口径取**挂载行级按序比对**（模板头注"重放挂载块"同源）；base 对同步作为 form-check 合入前的独立 PR（11 行补齐 + G1-1 断言面同步扩 + 双 boot 复跑）。**若拍板为整文件一致，则必须先全量同步且 persona 文案分歧一并裁决** |
| Q2 | super 形态的 profile 名与卷内目录 | 31 号 §2.5 未指定；镜像内 profile 名影响 `dsh --profile` 与卷内路径 | `eterna-super` / `$DSH_HOME/profiles/eterna-super`（与 profiles/eterna-super 清单同名对齐）；verify 脚本 home 用 `.eterna-home-super` |
| Q3 | super compose 的宿主中继端口与容器名（并存相容只约束"不得撞 base"，值未定） | docker-compose.yml:21,28 现占 eterna-agent / 9310 | 宿主中继 `9320:9310`（对称 3210→3220）；容器名 `eterna-agent-super` |
| Q4 | `ETERNA_FORM` 非法值处置 | 31 号 §2.5 只定义二值，未定义非法值 | fail-closed 拒启（exit 非 0 + 日志指名），与 §2.5"schema 前向守卫拒启"同纪律 |
| Q5 | toolkit 的 Tier 归属登记 | G0-6 ① 初始 Tier2 只点名 tasks、workbench；D1 暂定 toolkit"base 可选挂载"——可被 base 挂载的包按 §2.2 语义不应是 Tier2 | toolkit 落地 PR（WS-B）时登记 tier1；登记动作按 G0-6 ①"新包落地时登记"执行，归属值随 D1 改判联动（31 号 §5：D1–D4 如有异议随时改） |
| Q6 | G1-2"行序正确"的机器口径 | 33 号 G1-2 原文只列判据未给实现 | 行序由 FORM001 按序比对静态看护（清单↔模板），verify-eterna-super 只断言 active——两命令分工，避免双处维护行序表 |
| Q7 | super-bundle 内容清单 | 31 号 §2.1 只给产物名 `super-bundle` | tasks 可用后（M5 窗口前）由 WS-A/市场 owner 定清单并回填本文 S-9；在此之前 S-9 不动工 |
| Q8 | 每日 schedule 的 cron 时点与 job 组织 | 33 号 §6 缺口 13 给"verify job 加步骤 / 新增 cron job"两选项，未择一 | 双轨（PR 面进 verify job + 独立每日 job）；cron 时点任取固定值（实现自由度，非行为设计） |

---

## 10. 与既有文档的关系

```
31（双形态治理）§2.5/§6 ──本文是其实施清单 1–4 的开发规格──→ S-3/S-4/S-5/S-6/S-9
33（总工作流与门禁）G0-6/G1-2/§5/§6 缺口 1·13 ──本文是两条待建门禁的命令实现──→ S-1/S-2/S-6/S-7
32（最终态开发方法）M1 ──双形态门禁建立的里程碑时点──→ S-8、§7 排期
24a（拍板事实源）第四轮 ──Tier 规则/双门禁/双 tag 的决策原文──→ 全文依据链顶端
34（tasks 包详设草案）/后续 WS-B·D·E 开发文档 ──挂载行内容与交互细节的承接方──→ §2 非目标、§5 指针表
```

本文不改变 31/33 号任何判据；发现与其冲突之处以 33 号为准并回写本文。
