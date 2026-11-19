# 38-T1 · 原型四件评审登记（G2-D1 格式）（2026-11-18）

## 状态头

- **任务归属**：38 号 T1「原型四件产出与评审登记」（38 号 §5 表 T1 行、§6.1；33 号 G2-D1）
- **本记录性质**：评审结论登记——按 38 号 §6.1「评审结论一行（✅/❌ + 日期）」的 G2-D1 登记格式落盘本文件；登记落点为本文件（任务指令指定 `docs/design/reviews/prototype-review.md`），替代尚未建立的 `docs/design/prototypes/INDEX.md` 承担登记职能（目录口径差异见 §三，排期清单第 18 行在案）
- **评审对象**：`docs/prototypes/` 五件（四件原型 + index 总览；纯 HTML + CSS 静态稿，令牌实值内联自 `packages/ui/src/tokens.ts`，各文件页脚已自declare）
- **评审口径**：双主题 × 三断点 × a11y 清单（38 号 §6.1「评审口径」行；30 号 §5 流程图）；对照清单 = `docs/prototypes/index.html` §「硬要求落地位置（评审对照）」七行表
- **评审证据**：本机机械核对（grep/perl 计数，命令与输出见 §二，2026-11-18 实跑）；「base 本地 e2e 通过」为任务给定事实（本记录未重跑 base e2e；旁证 = [40-S-8 记录](2026-11-18-M1基线落盘与base形态记录-40-S-8.md) 同日实测 `verify-eterna-web` OK·15 PASS）
- **关联**：[全量排查清单](2026-11-18-全量排查-未完成开发项目清单.md) 第 18 行（38-T1 partial：目录/格式/登记三者缺口的登记半边由本文件补齐）

## 一、G2-D1 格式评审结论登记行（每件一行：✅/❌ + 日期）

| 原型 id（38 号 §1.2 约定） | 30 号 §5 清单对应 | 产物（本机实测字节） | 评审结论 | 日期 |
|---|---|---|---|---|
| `task-sidebar` | 原型 1 任务侧栏（任务分组 + 状态点） | `docs/prototypes/01-task-sidebar.html`（48,735 B） | ✅ | 2026-11-18 |
| `attention-card` | 原型 2 Attention 卡（站内横幅 + 渠道卡片两形态） | `docs/prototypes/02-attention-card.html`（44,520 B） | ✅ | 2026-11-18 |
| `workbench-views` | 原型 3 工作台五视图静态稿（含信息流图三要素：节点布局/卡点态/图例） | `docs/prototypes/03-workbench-views.html`（76,945 B） | ✅ | 2026-11-18 |
| `worker-inspector` | 原型 4 worker 检查器（子代理树 + 上下文/成本条） | 可视面含于 `03`（五视图之五：worker 检查器）；`docs/prototypes/04-flow-a11y-list.html`（45,807 B）为其 Canvas 旁挂 a11y 等价列表（30 号 §7-1③ 配套，超出原四件计划、补 Canvas 无 DOM 缺口） | ✅ | 2026-11-18 |

四件主体内容覆盖核对（grep 实测命中数）：01 含 `person/answer|approve|accept`、`working/queued` 分组与状态点×5、分支入口；02 含站内横幅×6 + 渠道×13 两形态、一次一问×2、批准×12/拒绝×4/补充说明×4、双确认×1、冷静期×4、超时升级×8；03 含五视图（工作监控×4/信息流×7/日志监控×4/评测监控×4/worker 检查器×4）+ 子代理树×3 + 上下文占用×4 + 成本×4 + 卡点×6 + 图例×2 + 节点布局 + 冲突三指标（attach×2/duplicate×2/插队×2）；04 含等价列表×3 + 工单清单/节点清单 + aria 属性×49 + 键盘可达（tabindex/kbd/focusable×5）。

## 二、评审口径机械核对（双主题 × 三断点 × a11y，2026-11-18 本机实跑）

逐文件 grep/perl 计数核对（四文件共用同一套页面骨架，除触控目标外计数一致；03/04 的 36px 命中更多系页面特有控件）：

| 评审清单项（index.html §硬要求 表） | 01 | 02 | 03 | 04 | 核对命令 |
|---|---|---|---|---|---|
| 深浅主题切换（`data-eterna-theme` + `prefers-color-scheme: dark` 块 + 切换按钮） | 5/2/2 | 5/2/2 | 5/2/2 | 5/2/2 | `grep -c` |
| 三断点 1100/760/640（`max-width` 媒体查询） | 2/2/2 | 2/2/2 | 2/2/2 | 2/2/2 | `grep -c` |
| 语义标题（单一 h1）+ 跳转链接（skip-link） | 1/3 | 1/3 | 1/3 | 1/3 | `grep -c` |
| focus 光圈（`:focus-visible` × `--et-focus-ring`） | 2/2 | 2/2 | 2/2 | 2/2 | `grep -c` |
| `prefers-reduced-motion` 关动效 | 1 | 1 | 1 | 1 | `grep -c` |
| 触控目标 ≥36px（`min-height: 36px`） | 3 | 3 | 5 | 4 | `grep -c` |
| 中文文案（`lang="zh-CN"`；正文全中文） | 1 | 1 | 1 | 1 | `grep -c` |
| 无 emoji 功能图标（内联 SVG symbol×31；emoji 字符扫描） | 0 | 0 | 0 | 0 | `perl -CSD` 全文扫描 |

四件均 **✅ 全项通过**；字面值内联令牌为静态稿刻意为之（各文件头注释自declare「令牌内联自 `packages/ui/src/tokens.ts`」），不适用 G0-2 lint 面（该门禁作用于 `packages/*/src` 客户端代码，原型为 docs 静态稿）。

## 三、目录口径现状（如实记录，不掩盖差异）

33 号 G2-D1 的字面命令口径为 `docs/design/prototypes/<id>/*.png`（每 id ≥2 张且 >20KB）+ `docs/design/prototypes/INDEX.md` 登记行。本机实跑（2026-11-18）：

```
ls docs/design/prototypes/        → No such file or directory（exit 1）
find docs -name '*.png' -path '*prototype*' | wc -l → 0
ls docs/design/prototypes/INDEX.md → No such file or directory（exit 1）
```

即：**字面 G2-D1 命令口径未满足**（产物为 HTML 而非 PNG，目录为 `docs/prototypes/`）；但产物本体（四件静态稿 + 总览评审对照表）齐全、单件 44–77KB（>20KB 档位）、评审口径（双主题 × 三断点 × a11y）已按 §二 全项核对通过。目录口径与 33 号对齐（HTML→PNG 导出 + `INDEX.md` 设立）或拍板改口径，归 38-T1 剩余半边（排查清单第 18 行在案），不在本登记文件的处理范围。
