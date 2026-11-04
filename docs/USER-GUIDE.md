<!--
  同源文档:本文件与用户级 skill ~/.agents/skills/agent-basis-guide/SKILL.md 同源
  (正文逐字节一致,仅头部来源说明不同)。修改任一处后必须重新同步另一处:
  由 SKILL.md 去掉 YAML frontmatter 生成本文件。
-->

# agent-basis 使用指引(装完即会用)

三个入口,一套能力:

| 入口 | 到哪 | 干什么 |
|---|---|---|
| 对话 | Web 会话输入框直接发 prompt(下文示例逐条可用) | 触发记忆/知识/治理/活动策划全部工具 |
| 面板 | Web 侧栏「**基座面板**」 | 服务清单 + 操作指南(点击复制 prompt)+ 可观测样例 |
| 命令行 | 仓库根目录 | 评测(dsh-evals)、平台门禁(aievo-run)、领域包(packctl) |

## 快速定位

- 仓库:`/Users/sunny/.zcode/workspace/draft-50d92869-2a8d-4d02-8c95-cccdab6eafca/agent-basis`(下文相对路径均以此为根)
- Web 入口:`http://127.0.0.1:3080/?token=<token>`(token 从 `/tmp/basis-web-app.log` 里 `grep 'token='` 取);若 127.0.0.1 源页面挂死,换 `http://localhost:3080/?token=…` 即恢复
- 启动/重启(改了 glue/panel 代码后必须重启再测):
  ```bash
  pkill -f 'profile basis-web'; sleep 2
  cd /tmp/basis-ws && LITELLM_API_KEY=$(cat <仓库>/.secrets/litellm-master-key.txt) \
    nohup /opt/homebrew/bin/dsh --profile basis-web > /tmp/basis-web-app.log 2>&1 &
  ```
- 凭据只放 `<仓库>/.secrets/`(gitignored),绝不写进提交文件
- 面板三区块:①服务清单(governance / memory / knowledge / @event 工具清单+R3 标记)②操作指引(每能力一条示例 prompt,点「复制」粘到输入框)③可观测样例(最近会话 token / 缓存命中率)

## 功能触发示例(逐条对应面板指引)

> 第 1–7 条与面板「操作指引」逐条同源(`packages/panel/src/prompts.ts`,括号内为面板条目 id,面板 DOM 锚点 `data-basis-panel-prompt="<id>"`);第 8–12 条覆盖面板「服务清单」卡片上的其余工具;第 13 条是实测过的组合触发。把示例粘进会话输入框即可。

### 1. 记忆写入(面板 memory-write)

```
请用 memory_write 记住:用户偏好周五下午开会(实体 user:me / key meeting-preference)。
```

- 落库:`.basis/memory.sqlite3`(宿主 cwd 下);写入前过 PII 过滤
- 写入后该实体进入后续会话的系统提示记忆索引(≤500 token),无需重复交代
- 验收锚点:memory_write 输出含实体/键确认;面板「记忆 memory」卡片实体数 +1、最近 key 列表出现 `user:me/meeting-preference`

### 2. 记忆检索(面板 memory-search)

```
请用 memory_search 搜索「开会」,并在回答里带上每条命中的出处锚点(entity:…#版本)。
```

- 每条命中带出处锚点,形如 `entity:user:me/meeting-preference#1`
- 验收/自检口径:看**工具调用输出 JSON** 里的 `entity:` 锚点字段,不要拿全页文本做子串断言(用户消息回显会污染)

### 3. 记忆遗忘(面板 memory-forget)

```
请用 memory_forget 把实体 user:me / key meeting-preference 标记失效,并告诉我删了几行。
```

- forget = 逆闭包**真删**(物理删行),不是打标记;工具输出会报告删了几行
- 删完再看面板「记忆」卡片,实体数相应减少

### 4. 知识检索 + 后端健康(面板 knowledge-search)

```
请用 knowledge_search 检索「预算」,并附 knowledge_status 显示后端健康状态。
```

- 双后端:wiki-local(FTS5 混检)↔ WeKnora;未配置 WeKnora 时 `knowledge_status` 显示 wiki-local 活着、WeKnora not-mounted(属预期,不是故障)
- 命中带 provenance(出处);三层过期过滤(deprecated/superseded/未过审)不出现在结果里
- 验收录点:knowledge_status 输出含 `wiki-local`

### 5. 知识提案 fail-closed(面板 knowledge-propose)

```
请用 knowledge_propose 提交一篇《会议预算模板》提案(fail-closed:未经人工评审放行不会发布)。
```

- 默认**拒绝发布**:governance 规则显式 allow 才放行,否则停在待审提案(面板「知识」卡片待审提案数 +1)
- 这是有意的安全设计(fail-closed),不是 bug

### 6. 预算计算(面板 budget-calc,R0 静默)

```
请用 budget_calc 计算:总额 198000 元,按 餐饮30%/场地25%/物料20%/应急10% 给出预算分解。
```

- 工具吃分项 `lines`(数量×单价=小计),模型会先把"总额×百分比"换算成分项行再调用;输出 `kind: "budget-breakdown"` + `lineTotals`(逐行小计)+ `totalCny`(合计)。单算一项时同理(实测「算 198000 的 30%」→ `totalCny: 59400`)
- 可选 `baseBudgetCny`:附带超支金额/百分比与 R3 判定(>5% 提示必须走 budget_change 审批)
- 只读确定性计算(零模型调用),无副作用,不触发审批

### 7. 付款审批红线(面板 pay-deposit-redline,R3)

```
请用 pay_deposit 起草定金申请:合同 198000 元、定金比例 30%(R3:只出申请单,宿主审批 allowed-once 后才可执行,代理不直接付款)。
```

- 调用时先弹**宿主审批确认**(approval/asked):你在会话里批准(allowed-once)或拒绝,全程留痕(approval/decided)
- 工具本身只出申请单:输出 `kind: "payment-request"`、`amountCny: 59400`、`riskLevel: "R3"`、`executed: false`、`executor: "finance-officer"`——**代理永不代付**
- 同为 R3 需人工审批的还有:`budget_change` / `transfer_money` / `sign_contract` / `vendor_award`

### 8. 记忆读取(服务清单 memory 卡片)

```
请用 memory_read 读出实体 user:me 的全部有效记忆,按 key 列出。
```

- 读单个实体的当前有效记录(区别于 memory_search 的关键词跨实体检索)

### 9. 场地/模板检索(服务清单 @event 工具,R0)

```
请用 venue_search 查容量不少于 200 人的市中心场地,三家全列并统一含 AV 口径对比;再用 template_search 检索「发布会 策划案」模板对齐章节。
```

- 只读检索类工具,静默执行不出审批;场地输出含 `comparableTotalCny`(统一含 AV 折算价)与报价 `source`,比选必须引用来源
- 面板「@event 工具清单」卡片可看到全部 10 个工具与 R3 标记

### 10. 排期冲突检查(服务清单 @event 工具,R0)

```
请用 schedule_conflict_check 校验这份当日时间线:签到 09:00-09:30、开场 09:30-10:00、主论坛 10:00-12:00、午宴 11:30-13:00,活动窗口 09:00-18:00。
```

- 输出 `kind: "schedule-check"` 与 `overlaps`(上例主论坛与午宴重叠会被点名)、`outOfWindow`;时间用当日分钟数换算(14:00=840)

### 11. 对外发射,先确认(R2)

```
请用 send_email 起草给 vendor@example.com 的场地询价邮件,主题「XX 发布会场地询价」,给我发送前检查清单。
```

- `send_*` 类属 R2:调用即触发宿主确认;工具本身**不外发**,返回发送前检查清单与人工移交单,由执行侧发送
- 面板指引未单列 R2,风险档定义在 `packs/event-planning/hitl.yaml`

### 12. 资金/法务/定标/预算变更(R3 家族)

```
请用 budget_change 起草预算变更:基数 198000 调整为 225000,说明理由。
```

- `budget_change` / `transfer_money` / `sign_contract` / `vendor_award` 全部 R3:超支 >5%、对外付款、签合同、供应商定标四类高危动作,一律「起草 + 审批 + 授权人执行」
- `transfer_money` 只出守卫摘要(`guard 红线:资金动作一律由财务执行;agent 不得代付`),绝不执行转账

### 13. 组合触发(实测过的一条消息串多个工具)

```
依次执行:memory_search 搜索「开会」;knowledge_status;budget_calc 算 198000 的 30%
```

- 2026-11-04 真模型会话实测通过:三个工具依次调用,输出分别含 `entity:` 锚点 / `wiki-local` / `budget-breakdown` 与 `totalCny: 59400`

## 评测与门禁怎么跑

### 本地评测 dsh-evals(replay,无需模型凭据)

```bash
# 回放金集活动策划包:20/20 通过(含 3 条审批红线正确拦截)
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay

# 只跑内环 smoke 子集(9 条)
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --subset smoke
```

- 退出码:`0` 全过 / `1` 有失败 / `2` 用法错误;产物在 `dsh-evals-out/<时间戳>/`:`report.md`(通过率+失败分类)+ `sessions.jsonl`(可导 ai-evo)
- 真模型跑法:`--adapter acp`(经 DSH Python SDK 驱动真实会话;需 `LITELLM_API_KEY`,DSH_HOME 隔离宿主)

### ai-evo 平台门禁

- **平台入口:http://192.168.31.165:8201**(即 MaNas:8201,「模型评测平台」;数据集/任务/门禁结果都在网页上看)
- 凭据已配在 `<仓库>/.secrets/aievo-cli.json`(`node tools/aievo-run.mjs config show` 查看,key 打码);**凭据绝不入提交文件**
- 触发门禁并等结果(CI 主命令,轮询约 8 分钟):

```bash
node tools/aievo-run.mjs run task_e7cedc05e36c --wait --timeout 1800 --json
```

- 不触发新执行、只读最新结果:`node tools/aievo-run.mjs results task_e7cedc05e36c --json`
- 退出码(平台语义):`0` 门禁 passed(放行发布)/ `1` failed(质量不达标,修 pack 别降阈值)/ `2` error(链路/超时等基础设施问题,不算质量结论)
- 当前 release 门禁:12 条(3 审批红线 + 9 正向),阈值 pass_rate ≥ 0.85 且 trajectory_match_rate ≥ 0.80;历史实跑 verdict=passed(2026-11-04)

### 领域包脚手架与体检(packctl)

```bash
node tools/packctl/bin/packctl.mjs init <行业名> --root packs   # 生成新行业领域包骨架
node tools/packctl/bin/packctl.mjs lint packs/<行业名>          # 结构/Cordis 纪律/金集完整性体检
```

- 接入一个新行业 = 复制 `packs/event-planning` 改 persona/skills/tools/policies/evals,验收口径 = 该包评测通过率

## 插件怎么从索引安装

### Web「发现」标签(推荐)

1. 打开 Web → 侧栏「**插件**」页 → 切到「**发现**」标签
2. 首次使用点「**添加索引源**」(或工具栏「插件索引」菜单 →「管理索引源…」),填入插件索引的 http(s) URL——索引是一份 JSON 清单,列出可安装的组合包。
   本仓库自家插件(@basis/glue、@event/pack)的长期索引源:**`https://raw.githubusercontent.com/mahingbun-dev/agent-basis/main/market/index.json`**
   (离线演示备用:仓库根 `python3 -m http.server 8765 -d market/` 后填 `http://127.0.0.1:8765/index.json`)
3. 搜索/按标签筛选 → 卡片上点「**安装**」→ 确认对话框(显示版本、来源 spec、registry)→ 确认后进入安装检查界面
4. 装完到「已安装」标签启用/停用;装新组合包默认启用,basis-web profile 无 HMR 时按提示重启生效

### 会话内让代理装(工具链)

```
用 plugin_market 搜一下索引里有没有 <关键词> 相关插件;有就把推荐版本的 target 和 registry 用 plugin_manager 的 install_bundle 装上。
```

- `plugin_market` 只读(列索引/搜索/列版本,免审批),返回的每个版本自带安装参数 `target` + `registry`
- `plugin_manager` 的 `install_bundle` 用这些参数安装,**每次调用需要你批准**(审批卡确认)

### 命令行

```bash
/opt/homebrew/bin/dsh plugin --profile <name> add <package>    # 等价于在 profile 目录 pnpm add
/opt/homebrew/bin/dsh plugin --profile <name> remove <package>
```

### agent-basis 自家插件(basis-web profile)

**推荐:走上面的「发现」标签 + 本仓库长期索引源安装,不再手工拷文件。**以下 file: 依赖方式仅作开发态联调保留(源码改动即时生效):

```bash
pnpm --filter @basis/panel run verify            # 先构建验证(含 lib/client.js)
cp -R packages/panel ~/.dsh/profiles/basis-web/packages/panel
# profile 侧 package.json:dependencies 加 "@basis/panel": "file:packages/panel";
# dsh.profile.bundles 追加 "@basis/panel";glue 同款做法
cd ~/.dsh/profiles/basis-web && pnpm install
# 然后按「快速定位」里的命令重启宿主再测
```

## 常见问题

- **R3 工具"只出申请单"?** 设计如此:付款/转账/签合同/定标/预算变更四类高危动作,代理只起草,宿主审批(allowed-once)通过后由财务/授权人执行;拒绝与同意都留痕
- **knowledge_propose 被拒?** fail-closed:未经人工评审(或 governance 规则显式 allow)不发布,提案停在待审列表
- **面板 WeKnora 显示 not-mounted?** glue 只装配了 wiki-local 后端;WeKnora 需配 enabled+baseUrl+token 三要素才会挂载
- **改了 glue/panel 代码不生效?** 必须重启宿主(命令见「快速定位」)再测
- **怎么判断一个功能真的触发了?** 看工具调用的**输出 JSON 特征字段**(memory_search 的 `entity:` 锚点、budget_calc 的 `budget-breakdown`、pay_deposit 的 `payment-request`),或面板卡片计数变化;不要拿页面全文做子串匹配
