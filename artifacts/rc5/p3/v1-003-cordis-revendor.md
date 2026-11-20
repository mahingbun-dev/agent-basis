# RC5-V1-003 — `core/cordis` 版本 / 来源 / LICENSE / NOTICE

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:280`（RC5-V1-003，P0；断言「4.1.0；NOTICE 更新」）
- 任务：T19（54 §4.5：「4.1.0-basis.1；12 变换；LICENSE/NOTICE；cordis tests 5/5」）
- 判定：**PASS**（本 session 实跑；含 1 处修复，见「修复」）

## 1) 版本

```bash
cd /Users/sunny/code/agent-basis-rc5
node -p "require('./core/cordis/package.json').version"
# → 4.1.0-basis.1        EXIT=0
```

`core/cordis/package.json:4` `"version": "4.1.0-basis.1"`，`license: MIT`，`private: true`。

## 2) 来源（上游 rc.5 实读核验，只读）

```bash
cd /Users/sunny/code/deepseek-harness
git rev-parse dsh-v0.2.2-rc.5^{commit}
# → 9c2670d3bce5275e0d1610272958121af87787bb     (与 README 声明一致)
git show 9c2670d3…:vendor/cordis/package.json | grep '"version"'
# → "version": "4.1.0"
git archive 9c2670d3… vendor/cordis | tar -x -C /tmp/rc5-cordis-upstream
```

上游 `vendor/cordis` 在该 tag 确为 **4.1.0**；`core/cordis/package.json:2` 描述的
「vendor 自 @deepseek-ai/cordis 4.1.0(MIT)」与实读一致。

## 3) NOTICE

`core/cordis/README.md:5-10`（`## NOTICE(vendor 出处与许可)`）已更新为 4.1.0：

```text
- 来源:@deepseek-ai/cordis 4.1.0(上游 tag `dsh-v0.2.2-rc.5` = `9c2670d3bce5275e0d1610272958121af87787bb`,目录 `vendor/cordis`)
- 上游仓库:https://github.com/deepseek-ai/deepseek-harness,作者 Shigma 与 DeepSeek-AI
- 许可:MIT(保留原版权声明,见 `LICENSE`;本仓库发行物同样以 MIT 对外)
- vendor 日期:2026-11-20(上游 4.1.0 发布提交 `60d811de43`,2026-11-04)
```

## 4) LICENSE

`core/cordis/LICENSE`（MIT，`Copyright (c) 2021-present Shigma`）与上游逐字节相同：

```text
034fb52b1d57360ecbae6cb1632a88f86fd7c3d3f5631a5f082710203dda0be7  core/cordis/LICENSE
034fb52b1d57360ecbae6cb1632a88f86fd7c3d3f5631a5f082710203dda0be7  /tmp/rc5-cordis-upstream/vendor/cordis/LICENSE
```

**修复**：该文件此前**未被 git 跟踪**（`git status` → `?? core/cordis/LICENSE`；
`git check-ignore` 返回 1，即并非 `.gitignore` 排除，而是漏 `git add`）。README 第 9 行
「保留原版权声明,见 `LICENSE`」在未入库时对发行物不成立。已执行：

```bash
git add core/cordis/LICENSE     # → A  core/cordis/LICENSE
```

（只 stage，不 commit、不 push——按硬边界。）

## 5) 12 项机械变换的落点

```bash
diff -ru /tmp/rc5-cordis-upstream/vendor/cordis/src core/cordis/src
#  → artifacts/rc5/p3/v1-cordis-transform-4.1.0.diff (356 行)
```

`diffstat`：

```text
 events.ts   |    6 +++--
 fiber.ts    |   62 +++++++++++++++++++++++++++++++++-------------------------
 logger.ts   |   20 +++++++++++-------
 reflect.ts  |    7 ++++--
 registry.ts |   64 +++++++++++++++++++++++++++++++++---------------------------
 service.ts  |    5 +++-
 utils.ts    |    2 -
 7 files changed, 98 insertions(+), 68 deletions(-)
```

- 变换 1/2/3 → `fiber.ts`（参数属性、`const enum FiberState`、`namespace CordisError.Code`）
- 变换 4 → `events.ts`；变换 5/6 → `logger.ts`；变换 7 → `reflect.ts`
- 变换 8/9/10 → `registry.ts`（`RegistryService` 构造器、`namespace Inject.resolve`）与 `service.ts`
- 变换 11 → 5 处 `declare module './context.ts'` → `declare module '@core/cordis'`
  （`reflect.ts:7` / `fiber.ts:9` / `registry.ts:170` / `events.ts:33` / `logger.ts:6`）
- 变换 12 → 类型注补（分布同上）
- `context.ts`、`index.ts` 与上游**逐字节相同**（diff 0 行），符合 README「其余逐字节保留」

## 6) 声明出口与类型门禁

```bash
pnpm --filter @core/cordis declarations   # EXIT=0   → lib/types/*.d.ts（gitignored，CI 现产）
pnpm --filter @core/cordis typecheck      # EXIT=0
```

## 断言

- [x] 版本 = `4.1.0-basis.1`（bash/package.json）
- [x] 上游出处 = tag `dsh-v0.2.2-rc.5` / commit `9c2670d3…` / `vendor/cordis` 版本 4.1.0（上游仓实读）
- [x] NOTICE 段落为 4.1.0（README:5-10）
- [x] LICENSE 存在、与上游 sha256 相同、**已入库**
- [x] 12 项变换落点与 README 表一致；非变换文件逐字节相同
- [x] `declarations` + `typecheck` EXIT=0