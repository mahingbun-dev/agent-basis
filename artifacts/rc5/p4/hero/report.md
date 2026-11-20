# T33 / B19 — hero 品牌浮层（`conversation.hero.frame` + `conversation.hero.brand.mark`）

- 用例来源：`docs/design/54-rc.5开发与测试验收完整workflow.md:380`（T33 交付定义）
  与 `:451`（验收细节「`display:contents` HOC 外框…`z-index:-1` 仅此例外」）；
  `docs/design/50-上游rc.5合并开发落地文档.md:432-449`（§3.8 WP4-9）与 `:594-598`（§5.6）；
  `docs/design/47-上游DSH-0.2.2-rc.5合并评估与开发方案.md:489-520`（§2.14 槽位契约）
  与 `:1261-1290`（B19 落点）、`:97`（H13 风险）。
- 上游契约：`deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts:294-296`
  （`conversation.hero.frame` = `hoc`，`HeroFrameOwnerProps={hero:boolean}`；
  `conversation.hero.brand.mark` = `single`，`{size:number; className?:string}`）；
  宿主渲染点 `.../skeleton/ConversationContent.tsx:199`（frame 包滚动体）；
  上游参考实现 `.../ui-brand-official/src/client/home-whale/PixelWhale.tsx:38-52` 与
  `PixelWhale.module.css`（`.layer{display:contents}`、canvas `inset:0;z-index:-1;pointer-events:none`）；
  叠层前提 `.../ConversationRoot.module.css:13-15`（`.root[data-phase='hero']{isolation:isolate}`，
  `.root{position:relative;background:var(--dsw-alias-bg-base)}`）。
- 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`），执行日期 2026-11-20。

## 1) 判定

| 交付项（54:380） | 判定 | 证据 |
|---|---|---|
| 两个 slot | **PASS**（出厂 bundle 实装并实跑断言） | `verify.log`、`packages/brand/tests/client-hero.test.ts`（11 用例） |
| `display:contents` + `z-index:-1` | **PASS** | 计算样式断言 `assertions.json`（6/6 格）；层序像素断言 `layer-pixels.json` |
| 输入/滚动可交互 | **PASS（静态同构 harness）**：`elementFromPoint` 命中输入、真实点击聚焦、滚轮改变 `scrollTop` | `assertions.json` |
| 双主题截图 | **部分**：静态同构 harness 双主题 × 1440/900/390 截图已归档；**真实 DSH 壳内截图 NOT RUN** | `hero-{light,dark}-{1440,900,390}.png`；遗留 L1 |

未在本 lane 验证：真实产品壳 boot 后的 hero 首屏（需完整 `dsh` 运行时与登录态），见遗留 L1。

## 2) 改动清单（只动 `packages/brand/src/client/**` 与其测试）

| 文件 | 内容 |
|---|---|
| `packages/brand/src/client/hero.ts`（新增，64 行） | `HeroFrame` HOC：`hero=false` 直返 `props.children`（:53-56）；`hero=true` 返回 `display:contents` 外框 + 装饰品牌层 + children（:57-63）。装饰层 `HeroLayer`（:33-51）含玉晕、双玉环、恒灵标水印，全部 `aria-hidden`、零事件监听。 |
| `packages/brand/src/client/styles.ts`（新增，133 行） | `HERO_CSS`（:19）与 `injectHeroStyles`（:126，幂等 + `injectDesignTokens({bridge:true})`）。品牌层声明 `position:absolute; inset:0; z-index:-1; pointer-events:none`（:26-36）；断点 1100/760/640（:94/:99/:105）；`prefers-reduced-motion` 静态（:110）；深色降透明（:83）。 |
| `packages/brand/src/client/index.ts`（改） | 注册 `conversation.hero.frame`（:270-278，`id:'eterna-hero-skin'`、`order:0`，声明出现时才注入样式）与 `conversation.hero.brand.mark`（:280-283）；`BrandMark` 增加 `className` 透传与 `focusable:"false"`（:51-69）；disposer 撤销两席位（:292-293）。 |
| `packages/brand/src/client/state.ts`（改） | `SlotsFace.register` 选项补 `id?`/`order?`（:12-25，hoc 层必需）。 |
| `packages/brand/tests/client-hero.test.ts`（新增，343 行） | 出厂 bundle 装载 + slot 注册/元素树/样式纪律/幂等 11 用例。 |
| `packages/brand/lib/client.js`（重建，gitignored） | 74,117 B（原 18,562 B），sha256 `a28ce5904d2517c5d9291f38692ef98f7556f49b6c028408ced96b2385c444e3`；含 `eterna-hero-skin`、`conversation.hero.frame`、`conversation.hero.brand.mark`。 |

> 工作树里 `packages/brand/tests/brand.test.ts` 的 `0.2.2-rc.1→rc.5` 一行与未跟踪的
> `tests/skills-brand.test.ts`、`skills/` 增删**是既有改动，非本 lane 写入**（本 lane 未触碰）。

## 3) 契约逐条核对

| 契约 | 实现 | 机器证据 |
|---|---|---|
| owner props `{hero:boolean}`；`hero=false` 直返 children、不新增 DOM、不挂监听（47:1270、50:594-595） | `hero.ts:53-56` | 测试 `hero=false 直返 children`：返回值 `toBe(children)`（同一引用），`children=undefined` 时返回 `undefined` |
| 外层 `display:contents`（避免改变滚动体 flex 项身份，47:1271-1273） | `hero.ts:57-63`（内联 `display:contents` + `styles.ts:22` 规则双保险） | 测试断言 `style.display==='contents'`；harness 计算样式 `contents`（6/6 格） |
| 品牌层 `position:absolute;inset:0;z-index:-1;pointer-events:none`（54:451、50:596） | `styles.ts:26-36` | 测试逐条 token 断言 + 计算样式 `absolute/0px/0px/0px/0px/-1/none`（`assertions.json` 6/6） |
| `-1` 是唯一负层级例外，其余叠层 1/40/100/200/1000/1100/1500 | 全文件仅 `z-index: -1` 一处；无 `position:fixed` | 测试断言；`scripts/lint-ui-tokens.mjs` v4 阶梯 0 债务 |
| 品牌标：复用 `BrandMark`、按 `size`、`aria-hidden`（47:1279-1281、50:599） | `index.ts:51-69` 同一组件注册两席位 | 测试：hero 传 `{size:34,className}` → 34×34/`viewBox 0 0 24 24`/`currentColor`/`aria-hidden`；缺省 24 不回归 |
| 只用 `--et-*` 令牌、零字面色值（47:1276-1278、AGENTS.md §2） | `styles.ts` 全部 `var(--et-*)` + 文件内局部 `--et-hero-*`；零 `--dsw-` | 单测断言 + `lint-ui-tokens.log`（0 违例） |
| 断点只用 1100/760/640；<760 隐藏侧向装饰、gutter 16（47:1282-1284、50:597） | `styles.ts:94-108` | 测试断言断点集合 = {1100,760,640}；harness 390 宽 `ringDisplay=none`、mark 140px |
| `prefers-reduced-motion` 静态（54:451、47:1278） | `styles.ts:110-112` | 测试断言 `animation: none` |
| 深色主题降低透明度（47:1278-1279） | `styles.ts:83-86` | harness 计算样式：mark 透明度 light 0.045 / dark 0.03（6/6） |
| 不夺焦点/不挡输入（H13，47:97） | 品牌层 `pointer-events:none`、无 tabindex、无事件 | harness：`elementFromPoint(输入中心)=input.composer-input`、真实点击后 `activeElement=composer-input`（6/6）；滚动 `scrollTop` 88/208（>0） |
| 品牌层在内容之下（B19 测试项「z-index 计算在内容之下」） | 负 z-index + 宿主 `isolation:isolate` | 像素断言：不透明白卡内部两点（水印包围盒内 `(720,462)` / 盒外 `(720,702)`）均为 `rgb(251,250,246)`；同页卡片底色透明后同点为 `rgb(235,236,231)` → 水印确实画到该点而被卡片盖住（`layer-pixels.json`） |
| 未装载 ui-conversation 时不炸/无半套（47:1266-1268） | `slots.inject` 等待声明；样式注入放在 contributor 内 | `brand.test.ts` 既有 vm 冒烟仍绿（无 slots 时 apply 正常返回）；`verify.log` 38/38 |
| `ui-brand-official` 保持禁用、不重引鲸鱼（47:1288-1290） | 本 lane 未改 profile | 实读 `docker/profile/cordis.patch.yml.template:152-153`（`ui-brand-official: disabled: true`）与 `:651-652`（`eterna-brand` 已插入）；super 模板 `:153-154`/`:649-650` 同构 |

## 4) 实跑命令与结果（原文见同名 `.log`／`.json`）

```bash
cd /Users/sunny/code/agent-basis-rc5
node packages/brand/scripts/build-client.mjs            # EXIT=0（lib/client.js 72.5kb）
./node_modules/.bin/tsc -p packages/brand/tsconfig.json --noEmit   # EXIT=0
pnpm --filter @eterna/brand verify                       # EXIT=0：oxlint 0/0 + tsc + vitest 38/38
./node_modules/.bin/oxlint --config .oxlintrc.json packages/brand  # EXIT=0（10 files, 87 rules）
node scripts/lint-ui-tokens.mjs                          # EXIT=0：17 目录 287 文件 79 令牌，0 债务
node artifacts/rc5/p4/hero/harness-gen.mjs               # EXIT=0（从出厂 bundle 捕获 CSS/元素树）
node artifacts/rc5/p4/hero/harness-shoot.mjs             # EXIT=0（6 格截图 + 命中/滚动断言）
node artifacts/rc5/p4/hero/layer-pixels.mjs              # EXIT=0（层序像素断言）
```

- 测试规模：`packages/brand` 3 个测试文件 **38 通过**（新增 `client-hero.test.ts` 11 例）。
- `pnpm --filter @eterna/brand verify` 的构建步实际重建了 `lib/client.js`（72.5kb）。

## 5) 视觉证据（静态同构 harness，非产品入口）

`harness-gen.mjs` 在 vm 里以伪 document 驱动**出厂 `lib/client.js`** 的 `apply`，捕获
令牌桥接 CSS 与 `HERO_CSS`，再用伪 react 调用**注册得到的** `conversation.hero.frame`
组件生成真实元素树，序列化为 HTML；宿主骨架（`.root` position:relative /
`data-phase=hero` isolation:isolate、`.scroll`、输入卡）按上游 ui-conversation 手动同构，
标题文案取品牌改写后的「方寸灵台，运筹万里」。

截图（1440×900 / 900×780 / 390×780，双主题，`animations:'disabled'` 取静止帧）：

| 文件 | 说明 |
|---|---|
| `hero-light-1440.png` / `hero-dark-1440.png` | 首屏：34px 品牌标 + 标题 + 输入卡；玉晕/玉环/水印在内容之下 |
| `hero-light-900.png` / `hero-dark-900.png` | 1100 档：玉环收缩、水印 234px |
| `hero-light-390.png` / `hero-dark-390.png` | <760：侧向玉环隐藏、水印 140px、输入卡可点 |
| `decoration-only-light-1440.png` | 仅装饰层（卡片底色透明）人工核对用 |
| `harness-light.html` / `harness-dark.html` | 对照页原文（内联的是 `@eterna/ui` 令牌定义，色值仅存在于令牌源） |

6 格断言摘要（`assertions.json`）：

```text
frame=contents z=-1 pe=none coversRoot=true hit=input.composer-input focused=composer-input
light: scrollTop 88(1440)/208(900)/208(390)  markOp 0.045  markW 380/234/140  rings block/block/none
dark : scrollTop 88(1440)/208(900)/208(390)  markOp 0.030  markW 380/234/140  rings block/block/none
```

## 6) 遗留（按 `id|现象|级别|建议` 格式另报 LaneReport）

- L1 真实壳内 hero 截图/输入面 E2E 未跑（静态 harness 替代）。
- L2 brand bundle 18,562 → 74,117 B（+55,555 B），原因是把 `@eterna/ui` 令牌/基础件 CSS
  打进包（与 access/panel 同款配方）。
- L3 `injectDesignTokens` 共享 style 节点的 disposer 语义为既有缺陷（任一插件卸载会移除
  全产品共用节点），本 lane 未改。
- L4 负 z-index 依赖宿主 `.root[data-phase='hero']{isolation:isolate}`（rc.5 已具备）；
  上游若改该前提，装饰层会沉到根背景之下（不可见、不破面）。

## 7) 脱敏

证据只含本地路径、测试输出与合成 DOM/文案；无凭据、无 .env 内容、无内网地址、无容器操作。