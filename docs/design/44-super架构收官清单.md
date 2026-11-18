# 44 · super 架构收官清单(2026-11-19 清障)

> 状态:**形态收官**。M4 真实链路验收(43 号)达成后的收尾轮:A1–A6 清障施工全部落地
> 并按主题分组提交,静态门禁与真 boot 门禁本日复跑全绿(见 §四 实测);代码已 commit、
> **未 push**(push 待用户确认,§三)。本清单记:清障结果(§一)、仍开缝位(§二,
> 记录防误报)、用户门控遗留(§三)、复跑口径(§四)。A1–A6 为本清单的清障编号,
> 43 号 §四 的 ✅ 标注与其对应。

## 一、本次清障结果(A1–A6)

| 编号 | 主题 | 结论 | 落点(事实引用) | 验收(2026-11-19 实测) |
|---|---|---|---|---|
| A1 | channels 回执出站结算 | ✅ done | 新增 `packages/tasks/src/effects/channels-delivery.ts`:`channelsDeliveryFromContext(ctx)` 按结构端口消费宿主 'channels' 服务(双路反射,不 import 服务实例);派生注入于 plugin.ts:871(`channelsDerived`),plugin.ts:881-883 并入 resolved(显式注入恒优先);映射:available=`adapters.list().some(channelType===source)`、channelAllowed=`resolveThread(...)?.threadKey===channel.thread`(否则 dropped channelIgnored,outbox.ts:80)、send=`buildReplyCard→validateOutboundCard→sendCard`;'channelGone' 落 dropped,其余原样上抛走退避(outbox.ts:59 retry [5000, 300_000] 吸收 eterna-tasks:587 先于 eterna-channels:593 的挂载时序) | channels-delivery.spec.ts 5 用例(假 channels world 全链 sent / 无绑定 dropped / 服务缺席惰性面 UNWIRED / channelGone / 挂载时序);plugin-boot.spec.ts 新增装配用例;glue channels-plugin.spec.ts 新增「结构端口(★A1 双包对接面)」describe;tasks 包 verify 47 文件 799 测试全过、glue 13 文件 118 过、channels 8 文件 77 过(均本日复跑) |
| A2 | 删归属行→boot 自动登记 orchestrator 主会话归属 | ✅ done | 新增 `packages/glue/src/plugins/tasks-access-bridge-plugin.ts`(`eterna-tasks-access-bridge`,:55 静态 `inject:['tasks']` 就绪才 apply,全程 reflect.get(name,false) 结构端口,fail-closed);access store.ts:313 `userIdByAccount`(:318 单 SELECT 不验密)+ store.ts:453 `recordSession` upsert;provide 面(plugin.ts:433-437,recordSession/userIdByAccount)已随 HEAD 1b87043 在库;glue index.ts 双导出 + package.json exports 子路径 `./tasks-access-bridge-plugin`(挂载行 `@eterna/glue/tasks-access-bridge-plugin` 的解析支撑);幂等:sessionOwner(masterId)===userId 即跳过 | glue tests/tasks-access-bridge-plugin.spec.ts 8 用例(删行自动登记/幂等计数 0/改判覆写/账本面残缺 fail-closed/ctx.tasks 缺席/masterId 未引导不猜/配逆不撤行);access store.spec.ts +2;glue verify 118 过、access verify 35 文件 340 过(均本日复跑)。**联调断言未跑**(删行→重启→行自动在→/api/session/prompt 200,需 :3220 实例重启权限,§三/§四) |
| A3 | DSH 0.2.2-rc.1 版本钉与名字依赖核对 | ✅ no-change | 零改动:deepseek-harness package.json:3 与 agent-basis package.json:26 均 `0.2.2-rc.1`(grep 实证);dsh.ts:41-45 workerSessionId/ticketOfSession 及 18 个消费点逐一命中同一约定;sessions.ts:172-180 ensure 仅在 `session/not-found` 分支具名 create 并按名复解析,第三方竞态 minted id 永不进入 tasks 映射 | 契约推演逐行核实;`worker session id=宿主 uuid` 未复核(未起宿主;~/.dsh/sessions 只读盘点 33 键全 `session-<uuid>`,与契约相符);真实链路探针留 M4 式验收脚本。核对期间报告的 tasks 包 oxlint 4 错系当时树态,现树已净(本日 oxlint 0/0,见 §四) |
| A4 | workspace 标题与 会话标题解耦(根因修复) | ✅ done | sessions.ts:177 改 `workspaces.create(cwd)`(rc.1 createCanonical:同 path 幂等复用不改 title,标题回落宿主缺省=目录末段;头注 :9-14 与端口注 :54-56 同步);tests/fixtures/host.ts:294-305 假件对齐幂等语义;新增 tests/sessions.spec.ts 3 用例 | sessions.spec 3 用例过;tasks 全包兜底 46 文件 793 过(施工时)→ 本日全包 47 文件 799 过(含 A1 新 spec)。43 号 §四 的「归 workbench 打磨」归口已按本条回写勘误(A4 ④,随本清单同批提交) |
| A5 | super 形态收尾:toolkit 登记 + realm 对齐 + 注释刷新 | ✅ done | docs/tiers.yml tier1 登记 `toolkit`(40 号 §9 Q5 拍板,30 名注记刷新);profiles/eterna-super/cordis.patch.yml:587 eterna-tasks 行补 `config.realm=admin`(:592),super 专属块注释刷新为四行已落地事实(tasks plugin.ts:1036 / channels-plugin.ts:197 / interact-plugin.ts:81 / toolkit plugin.ts:105);容器模板 docker/profile/cordis.super.patch.yml.template:633-636 同款 `config.realm=admin`(工作树既有 A2 部署钉,随本批提交) | verify-eterna-super OK — 220 host entries、3 presets、cut rows inactive、kept rows active、super 挂载面 21 行 active(真 boot,本日复跑,退出 0) |
| A6 | eterna-web 清单对齐 + packctl FORM001 收口 | ✅ done | profiles/eterna-web/cordis.patch.yml:按容器模板序补 base 挂载面 16 行(governance/audit/egress/memory/knowledge/llm-doctor/brand/access 置 prompt-studio 前,usage-stats/panel 置其后)+ P1-T5 directory-picker 成对行(根级 `- id: directory-picker disabled: true` + insert directory-picker-host;只落 host 行会双注册 directoryPicker 服务 boot 红,2026-11-19 实测);scripts/verify-eterna-web.mjs HOST_KEPT_ROWS 扩 11 行 + BASE_MOUNT_PACKAGES symlink 面;tools/packctl form.ts:36 `ENFORCE_PAIR_DRIFT = true`、cli.ts:102 接线(旗标缺省传 undefined,不再把 warning 钉死) | form-check:`0 finding(s)(0 error)` 退出 0(本日复跑);verify-eterna-web OK — 215 host entries(真 boot,本日复跑);packctl verify 10 文件 100 测试全过(本日复跑) |

## 二、仍开缝位(记录防误报,均不阻已验收面)

| # | 缝位 | 现状证据 | 处置 |
|---|---|---|---|
| 1 | **A21-E3 入站 sink 未接线** | 与 A1 出站面是两条缝:TasksRuntime.sources 的 ChannelTriggerAdapter(plugin.ts:408)无人传给 channels `config.sink`(glue types.ts:239;channels-plugin.ts:146 仅条件透传,全仓无生产调用者)——webhook 入站 thread 绑定消息到不了 Engine | 随 A21-E3 落地;channels 插件侧按同名反射惯例反读 tasks.sources(43 号 §四 在案) |
| 2 | **tasks A21 端口部署形态走缺省面** | threadContext(plugin.ts:233)/readPath(:243)/repliedTo(:247)/syncSource(:249) 无注入者——挂载行 YAML 载不了函数,启用须经 glue 级注入;orchestrator_eval_read 显式报缺、policy_sync 报 nothingToSync | fail-closed 设计内,**非遗漏**;部署需要时经 glue 插件注入 |
| 3 | **webchat 回执回投接线位空** | sources/webchat.ts:63 宣称「回执经 outbox 投回会话」,但 source='webchat' 的 receipt 无对应 adapter,A1 落地后仍恒 Later 挂起(worker_report→主会话注入路径不受影响,已达用户) | 需独立 session 回投 adapter 或把 webchat 渠道化;随 A1 后续条目另案 |
| 4 | **tasks-access-bridge 挂载行未落** | 桥插件(glue/:29 `eterna-tasks-access-bridge`,:102 注释自称挂载行 `@eterna/glue/tasks-access-bridge-plugin`)在 super 容器模板与 super 清单均无此行(全仓 grep 0 命中)——单测全绿但部署态不加载 | 按 S-3 纪律 2:模板+清单两处加行 + 双跑 G1-1/G1-2(verify-eterna-super 行集派生自容器模板,加行须随真 boot 复验),随下次 boot 验收窗口落 |
| 5 | **form-check 演进项:行内 config 纳入比对口径** | form.ts:21 头注在案(现 extractEternaMountRows 只取 id+name,行内 config 漂移机器不可见) | 已登记未施工(A5 契约 ④) |
| 6 | **既有注释漂移两处** | verify-eterna-super.mjs:12-15 头注「行集从清单派生」vs 实源=容器模板(:35-41 起);cordis.super.patch.yml.template:619-630 陈旧注释(「三行…须待装配半边落地」) | 文档性,随下次触碰该文件时顺手勘误 |
| 7 | **A1 结构化载荷边界** | Receipt 现只有 text/kind(store/store.ts:39 extends OutboundMessage,core/ports.ts:117) | result/attention 六态/审批 purpose 结构化载荷本期不做,需要时扩 OutboundMessage |
| 8 | **文档编号撞号遗留(16×2、19×2)** | 16-独立测试计划与验收报告/16-金集评审工作表、19-progress/19-记忆系统开发文档 两两撞号;grep 实证:16-金集评审工作表零外部互引(改号零成本),19-progress 被 23-记忆多租户分库设计.md 与 41-记忆全局蒸馏落地-M-M4两阶段.md 两处引用 | 建议 16-金集评审工作表→16a、19-progress→19b(19a 已被 19a-spike-conclusions 占用);19 改号须同步上述两处引用,随对应文档属主收编(本轮任务面只改 41→43) |


## 附A、活体终验(2026-11-19 02:0x,主会话亲验)

桥挂载行落地 + realm 拨正(commit 0ec58ff)后,以真实实例复跑全链:

| 验收点 | 结果 | 证据 |
|---|---|---|
| A2 归属自动登记 | ✅ | 删 users.db 归属行 → 重启 → `orchestrator-Mr.Ma\|1` 自动回登,零手工 |
| realm 对齐 | ✅ | realm=admin 时桥 fail-closed 不登记(显式可见);拨正 Mr.Ma 后即通 |
| tenant 守卫 | ✅ | `/api/session/prompt` 对 orchestrator-Mr.Ma 直接 `accepted:true`(此前须手工补行) |
| 候选卡→route→工单 | ✅ | orchestrator_route accept(审批卡批准)→ ticket `6b3ac2dc…` + R4 目录 |
| worker 真实执行 | ✅ | 交付物 `.ticket/6b3ac2dc…/m4-clearance-final.md` 内容逐字=「清障后全链复验通过」 |
| A1 回执面 | ✅(按契约) | outbox 落回执行;webchat 无渠道适配器 → available=false → Later 持有退避(channels-delivery.ts 头注边界,非缺陷);飞书/微信适配器接入后即真实出站 |
| A4 侧栏双名 | ✅ | workspace 组=「Mr.Ma」(账号目录名),会话名解耦,无双名 |

过程发现(设计内行为的观察,记档):
1. **Eval deadline(120s)< 审批倒计时(215s)**:慢批准会先撞 Eval 超时(unavailable/timeout,
   trigger 重排);模型自动重试 route 二次(修掉 worktree_name 校验拒因)即恢复出票。
   两窗口的协调策略归后续 UX 打磨(审批倒计时宜 ≤ Eval 剩余时间)。
2. admin-era tasks store(workspaces/admin/.eterna)随 realm 拨正退役,数据保留作历史。

## 三、用户门控遗留(须人/凭据/拍板,机器不可自验收)

| # | 项 | 阻点 | 建议动作 |
|---|---|---|---|
| 1 | 飞书/微信凭据联调 | channels 真实渠道凭据(令牌/回调地址)只有租户侧有;A1 出站结算目前以假 channels world + 离线传输器单测覆盖,真实收发未验 | 凭据到位后按 39 号渠道联调口径跑一轮,并顺带验 A21-E3 入站缝(§二 #1) |
| 2 | 38 号 T14 双主题截图人工对照 | 工作台双主题截图对照属人工视觉验收(42 号前端视觉体系 v4 亦未提交) | 对照通过后在 38 号 T14 勾销并留截图路径 |
| 3 | push 确认 | 本轮只 commit 不 push(纪律) | 用户确认后 push;push 前建议再跑一次 §四 四连 |
| 4 | 审批超时窗策略 | approval 卡 215s 倒计时后按「无审批渠道」拒绝为期望行为(43 号验收实测人工批准可用),但窗长/兜底可配置策略未拍板 | 归 access 审批策略设计,拍板后落配置面 |

## 四、复跑口径(2026-11-19 实测全绿,均退出 0)

```bash
# ① 形态门禁三连(不 boot 的先跑,boot 级随后)
node tools/packctl/bin/packctl.mjs form-check     # → form-check: 0 finding(s)(0 error)
node scripts/verify-eterna-super.mjs              # → OK — 220 host entries … super 挂载面 21 行 active(真 boot)
node scripts/verify-eterna-web.mjs                # → OK — 215 host entries(真 boot;15 PASS/0 FAIL)

# ② 包级 verify(改过的五个面)
pnpm --filter @eterna/tasks verify     # oxlint 0/0 + tsc + vitest 47 文件 799 测试
pnpm --filter @eterna/glue verify      # 13 文件 118 测试(含 tasks-access-bridge 8 用例)
pnpm --filter @eterna/access verify    # 35 文件 340 测试
pnpm --filter @eterna/channels verify  # 8 文件 77 测试
pnpm --filter @eterna/packctl verify   # 10 文件 100 测试

# ③ E2E(43 号 §五 口径:起实例→web 信封投主会话→UI 批准→轮询 .ticket/<id>/)
# ④ A2 联调断言(需 :3220 实例重启权限):删 users.db sessions 中 orchestrator-admin
#    归属行 → 重启 → 行自动存在(owner=realm 账号 admin、workspaceId=null)→ /api/session/prompt 200
```

未跑项如实登记:根门禁 `pnpm verify` 全仓(lint-ui + 全部包)本轮未跑(跑的是上述
点名面);verify-eterna-web 的退出码经输出 `OK — 215 host entries` + 15 PASS/0 FAIL
判定(super 同口径退出 0 已实测)。
