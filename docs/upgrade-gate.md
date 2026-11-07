# 升级门禁 SOP(上游 @deepseek-ai/dsh-* 升版演练)

上游 dsh 发新版时,按本 SOP 走一遍:**改版本 → 本地门禁 → CI 门禁 → 裁决(放行/回滚)**。
本地与 CI 跑同一套四步命令,互证后才允许合入;任何一步红了,先回滚版本再排查。

## 0. 钉版纪律(先于一切)

- 全仓对 `@deepseek-ai/dsh*` 的依赖 specifier **必须是精确版本**(如 `0.2.2-rc.1`),禁止 `^` / `~` / `>=` 等范围符,也禁止 `*` / `x` 通配。
- `catalog:` 是合法形态:它由 `pnpm-workspace.yaml` 的 `catalog:` 段解析为精确版本,升版只改 catalog 一处。
- root `package.json` 里的 `file:` 链接(`@basis/basis-minimal`、`@basis/llm-openai`)是本地捆绑包链接,不参与版本钉版,**不要动**。
- 只出现包名、不带版本号的数组(如 `packages/panel` 的 `dsh.client.inject`、profile 的 `dsh.profile.bundles`)是装载清单,不是依赖 specifier,不适用本纪律。

钉版自查命令(输出应为空,有输出即违规):

```bash
grep -rn --include=package.json '"@deepseek-ai/dsh' . | grep -v node_modules \
  | grep -vE '"(catalog:|[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?)"'
```

## 1. 钉版地图(改哪里)

| 位置 | 形态 | 当前版本 |
|---|---|---|
| `pnpm-workspace.yaml` `catalog:` 段 | catalog(L1 插件 packages/* 与 tools/* 全部经 `catalog:` 引用) | `0.2.2-alpha.2` |
| `package.json`(root)devDependencies | 精确版 | `0.2.2-rc.1` |
| `basis/basis-minimal`、`basis/llm-openai` | 精确版 | `0.2.2-rc.1` |
| `.basis-home/profiles/*`、`.basis-home-t7/profiles/*` | 精确版 | `0.2.2-rc.1` |
| `tools/evals` | 精确版 | `0.2.2-alpha.2` |
| `packs/event-planning`、`market/glue-bundle`、`market/pack-bundle` peerDependencies | 精确版(不进 workspace,锁文件不涉及) | `0.2.2-alpha.2` |

同一张表里的版本属于同一族,升级时**整族一起改**,不要出现半新半旧。

## 2. 改版本

1. 编辑 §1 表中所有位置,把旧版本替换为目标版本(精确写法,不带范围符)。
2. `pnpm-lock.yaml` 会因 workspace 清单变化而过期,跑一次 `pnpm install`(非 frozen)刷新并检查 diff 合理;非 workspace 的 packs/、market/ 不进锁文件,无需额外动作。
3. `git diff` 逐文件过目:只应有版本号与锁文件变更,不应出现范围符。

## 3. 本地门禁(四步,与 CI 逐条一致)

在仓库根目录依次执行,任何一步非 0 退出即停,进入 §5 回滚分支:

```bash
# ① 安装:锁文件与清单必须严格一致
pnpm install --frozen-lockfile

# ② 全仓 verify(oxlint + tsc strict + vitest)
pnpm -w run verify

# ③ 领域包结构门禁:lint 所有 packs/*(packctl 只接受 pack 根目录,故逐包跑)
for d in packs/*/; do node tools/packctl/bin/packctl.mjs lint "$d"; done

# ④ 评测 replay 全量(与 docs/USER-GUIDE.md「本地评测」同一命令)
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay
```

评测产物落在 `dsh-evals-out/<时间戳>/`:`report.md`(通过率 + 失败分类)与 `sessions.jsonl`。

## 4. CI 门禁(互证)

推分支开 PR 后,`.github/workflows/ci.yml` 的 **`upgrade-gate`** job 会复跑 §3 的同款四步
(`pnpm install --frozen-lockfile` → `pnpm -w run verify` → packctl lint 所有 packs/* → dsh-evals replay 全量)。

- 本地绿 + CI 绿:互证通过,进入 §5 裁决。
- 本地绿 + CI 红:优先怀疑环境差异(node 版本、锁文件平台差异),修正后重跑;不许"本地是绿的"为由直接合并。
- 本地红:就地回滚或修复,不许推上去指望 CI 兜底。

## 5. 裁决:放行 / 回滚

- **放行**:四步全绿,且 report.md 无回归(对比升级前一次全量 replay 的通过率;当前基线 20/20)。合入 PR,版本号进入主干。
- **回滚**:任何一步红(退出码 1),或绿但有降级信号(通过率下降、新增 warning 聚集)。回滚方式:`git checkout` 还原 §1 各文件版本号 + 还原 `pnpm-lock.yaml`,重跑本地门禁确认回绿;升级尝试留档(报告 + 失败分类)供下次演练。

## 6. 退出码语义(dsh-evals)

| 退出码 | 含义 | 裁决含义 |
|---|---|---|
| `0` | 全部 case 通过 | **放行**(该步绿灯) |
| `1` | 存在失败 case | **质量不达标**:升级版本有行为回归,走 §5 回滚 |
| `2` | 用法错误或无 case 可跑(schema 坏文件仅打印 SCHEMA-FAIL) | **基础设施错误**:命令/数据/环境问题,与质量无关,修好重跑,不计入版本裁决 |

注意:`1` 与 `2` 的处置完全不同——`1` 拒绝这次升级,`2` 修环境后重跑。看到非 0 退出先分清是哪种,再决定回滚还是修复。

## 7. rc 红线

- `-rc.*` / `-alpha.*` 等预发布版本**不上生产**:只允许进入本仓库的开发分支做演练与 seam 对齐验证。
- 生产/发布产物(basis profile 装载、market bundle 构建)使用的版本必须是正式版;若当前仓库各钉版位含预发布版,升级演练的目标之一就是收敛到正式版后再放行。
