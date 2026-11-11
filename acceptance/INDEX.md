# 验收记录索引

> 依据 plans/2026-11-10-companion扩展开发计划与测试门禁.md §4 治理原则建立。
> 全部门禁通过与失败的工件按门禁 ID 存入 `artifacts/gates/<门禁ID>/`；失败记录永久保留。
> 实现者及其关联会话无判定权；执行者由用户本人书面指定（含用户本人亲自担任）。

| 门禁 ID | 阶段 | 执行人 | 执行日期 | 结论 | 工件 | 备注 |
|---|---|---|---|---|---|---|
| G-G0-01 | E0（决策门） | 用户本人 | 2026-11-10 | ✅ 通过（D9–D15 七项全部有明确结论） | [artifacts/gates/G-G0-01/decision.md](../artifacts/gates/G-G0-01/decision.md) | 用户会话回复「没问题」确认逐项推荐方案；本记录为后续全部门禁的前置输入 |
| E0-T3 红线清单签核 | E0 | 用户本人 | 2026-11-10 | ✅ 签核（用户会话确认「继续执行」） | docs/design/companion-security-redlines.md | 十条红线作为后续协作与安全门禁组（G-UX-10/11/12/13）及总验收的判定基准 |
| E0-T2 / E1-T1 / E1-T2 / E1-T5 | E0+E1 实现 | 实现者（本会话） | 2026-11-10 | ✅ 实现完成 + 自测证据（**非门禁判定**） | packages/extension-companion、packages/browser-relay、`pnpm -w run verify` 退出码 0（125 测试全过）、packctl tenant-scan 0 findings | 见下「实现者自测证据」 |
| G-CORE-01 | E1（核心链路） | 独立验收代理（用户指定派发） | 2026-11-10～11 | 通过（第一至四轮均 4/4；**终判轮（2026-11-11，第五轮，环境中断恢复后重采）4/4——五轮结论稳定，终判：通过**） | [artifacts/gates/G-CORE-01/verdict.md](../artifacts/gates/G-CORE-01/verdict.md)（含第二/三/四轮及终判轮判定段）、smoke/gate-evidence/G-CORE-01/（终判轮批次）、artifacts/gates/G-CORE-01/round2-evidence.txt、round3-evidence.txt、round4-evidence.txt、final-evidence.txt | 用户书面指定派发代理执行验收（litellm mimo-v2.6-flash）；五轮独立复核标题均逐字符一致（三方指纹 14ch:7dd9587a）；判据 4 以会话导出+egress 审计日志双源核验（seq 18 isError=false，窗口内关键词检索 0 命中）。遗留（五轮未闭合，定性为证据留痕形态缺口，不阻断布尔结论）：地址栏截图、扩展设置页截图；relay/扩展侧日志未归档；UI 工具条目为空 |
| G-CORE-02 | E1（核心链路） | 独立验收代理（用户指定派发） | 2026-11-10～11 | 通过（第一至五轮均不通过——判据 1/3 缺口逐轮收窄至「click 成功 0 次」；**终判轮（2026-11-11，第六轮，环境中断恢复后重采）4/4 首次全部通过——终判：通过，阻断解除**） | [artifacts/gates/G-CORE-02/verdict.md](../artifacts/gates/G-CORE-02/verdict.md)（含第二/三/四/五轮及终判轮判定段）、smoke/gate-evidence/G-CORE-02/（终判轮批次）、artifacts/gates/G-CORE-02/round2-evidence.txt、round3-evidence.txt、round4-evidence.txt、final-evidence.txt、digest.json | 失败-修复-重跑链：① egress 白名单补 hn.algolia.com（第二轮修复）→ 判据 2 转通过；② stale-ref 误拒根治（第三轮）；③ 纪律第 7 条消除 URL 直拼参数、fill 首次成功（第四轮）；④ 三步调用序列达成但 click 遭合理 STALE_REF 拒（第五轮）；⑤ **终判轮闭合**：模型在 fill 自动提交致 ref 失效后先重新 snapshot 取新 ref（e811）再 click——**六轮首次成功的 click**（isError=false，同 tab 导航至 HN 讨论页），判据 1（三类各 ≥1 成功+顺序子序列）/判据 3（最后一次点击后的快照含条目链接文本）成立，判据 2 与 hn.algolia API 基准逐字符一致（标题指纹 43ch:a22118cf、链接 70ch:d6f3515c）、判据 4 通过；第五轮判据 3 口径分歧随 click 成功消解。**digest 整改闭合**：gate-digest.mjs 重写版（按话术匹配会话/callId 配对/结构化 isError）输出与会话导出独立复算一致，恢复证明力（digest-session-calls.json 不再产出）。遗留：地址栏截图形态缺口、relay/扩展侧日志归档、UI 工具条目为空（均不阻断） |
| G-CORE-03 | E1（核心链路） | 独立验收代理（用户指定派发） | 2026-11-10～11 | 不通过（第一轮：任务未执行、4 判据全部无法判定；第二轮：1/4 不通过、2/3 通过；第三轮：1/2/4 不通过、3 通过——content_filter 中断）；**终判轮（2026-11-11，第四轮，裁决①②生效+场景经用户澄清细化为科技门户 IT之家）4/4——终判：通过，阻断解除** | [artifacts/gates/G-CORE-03/verdict.md](../artifacts/gates/G-CORE-03/verdict.md)（含第二/三轮及终判轮判定段）、smoke/gate-evidence/G-CORE-03/（终判轮批次）、artifacts/gates/G-CORE-03/round2-evidence.txt、round3-evidence.txt、final-evidence.txt、digest.json、ruling.md | 失败-修复-重跑链：harness 时序/悬置（已修复）→ stale-ref 误拒（已根治）→ 点击导航语义 openedTabs 回执（裁决①落地：本轮 click 回执 openedTabs 上报详情页 tab、标题含点击前锚文本、同 tabId 快照与截图佐证，因果链坐实，判据 1 通过）；content_filter 不可抗力（裁决②换站机制落地：场景经用户澄清细化为科技门户 IT之家、话术消歧「点开快照中第一条新闻链接」——细化依据派发单记录，ruling.md 文本未含、出处如实登记，建议补录）→ 本轮回答完整产出、无内容过滤中断，判据 2/4 通过（正文首段 75 字符基准逐字符比对一致、指纹 75ch:18ff80a0 复核无误取；3 次工具调用全 isError=false、turn completed）；判据 3 通过（ref=e340 点击前快照在案）。纯 snapshot→click→snapshot 三步浏览器链路，web_fetch/URL 直导航兜底未再现。「第一条新闻链接」落点核验自洽（热搜横幅①②编号条目与广告横幅渲染佐证 agent 消歧；更严口径分歧如实登记）。遗留：地址栏截图形态缺口、relay/扩展侧日志归档、UI 工具条目为空（均不阻断） |

## 实现者自测证据（2026-11-10，E1 冒烟——非门禁判定）

- 环境：Chromium for Testing 159.0.8154.0（headless=new + --force-renderer-accessibility + --load-extension）+ relay 127.0.0.1:9310 + 扩展 0.1.0 开发者加载。
- 全链结果（smoke/e1-smoke-result.json，exit=0）：
  1. ✅ relay 启动（/extension /cdp /api/tools /fixture）
  2. ✅ 扩展 SW → wss 连接 relay（hello 握手 proto=1）
  3. ✅ browser_snapshot {url:fixture} → a11y 快照（heading/paragraph/textbox[ref=e10]/button「提交」[ref=e13]/link[ref=e16]）
  4. ✅ browser_fill（selector=#kw → value=playwright）
  5. ✅ browser_click（selector=#go → 导航至 /fixture/result?text=playwright）
  6. ✅ 动作后快照含预期内容（关键词：playwright）
  7. ✅ example.com 真实快照（R-02 场景，title=Example Domain）
- 工具协议要点：感知走 DOMSnapshot.captureSnapshot（browser-use 同款主通道；chrome.debugger 下 AX 域整树 ignored 不可控，已实测确认并绕开）；ref=e<backendNodeId> 文档内稳定；点击为 CDP Input 可信事件（DOM.resolveNode→callFunctionOn 取视口中心）。
- 单测：relay-core 10 项（握手/自动挂载/session 转发/detach 分类/生命周期/错误码）+ ax-snapshot 7 项（已由 DOMSnapshot 通道替代，保留作 AX 通道回归基础）。

## E1 挂载验证（实现者证据，2026-11-10）

- `scripts/verify-eterna-web.mjs`（真 boot + pluginInventory/list 断言）exit=0：
  200 host entries 全 settle、`mcp-browser` enabled+active、22 裁行全 inactive、124 保留行 enabled+active。
- MCP 协议级：官方 SDK 2.2.0 Client + StdioClientTransport 对 `dist/mcp.mjs` connect 220ms 成功、
  tools/list 返回三工具（实测根因：响应帧缺 `jsonrpc:'2.0'` 时 SDK zod 校验静默丢弃全部响应——
  根因与修复已注释在 mcp.ts）；era 探针 `server/discover` 按 -32022+supported 语义毫秒级回落 legacy。
- 工具面挂载完成 → G-CORE-01/02/03/05 的「eterna 会话」前置条件就绪（待模型 key + 独立验收代理）。

## G-CORE 门禁待执行清单（实现者无权判定，待独立验收代理）

| 门禁 | 阻塞前置 |
|---|---|
| G-CORE-01/02/03/05 | ① 浏览器工具挂进 eterna 会话工具面（MCP server 化或 DSH provider 化——实现者待办）；② 用户书面指定独立验收代理 |
| G-CORE-04（登录态只读） | 用户本人提供已登录站点环境 + 书面确认单 |

## 失败-修复-重跑链

- 2026-11-10 E1 自测期间（实现者内部迭代，非门禁运行）：chrome.debugger attach 竞态（Another debugger）→ 两端在途去重；AX 域整树 ignored → 感知通道切换 DOMSnapshot；backendNodeId 跨域编号 → DOM.resolveNode 桥接。修复过程细节见实现会话记录。


## 升级裁决登记（2026-11-10）

- G-CORE-03 两项升级裁决（判据 1 新标签口径 / content_filter 不可抗力换站重跑）：用户本人裁决，见 artifacts/gates/G-CORE-03/ruling.md；第四轮判定按裁决口径执行。

## 环境中断登记（2026-11-11 01:5x）

- litellm 网关（192.168.31.165:4000）不可达（Connection error，模型重试 5/5 失败）——第六轮采集被阻塞。
- 中断前最后一轮完整采集（2026-11-11 00:13-00:14，纪律分支引导版）：G-CORE-02 实序 snapshot→fill→click!STALE_REF→snapshot（站点自动提交致 ref 失效，模型未用新 ref 重试 click——判定代理第五轮已定性）；G-CORE-03 机械 digest 全绿（snapshot→click→snapshot 三步零错误、ref e220 在点击前快照在案、openedTabs 上报详情页、判据 2 基准比对一致、无 content_filter 中断——裁决①②生效下四判据证据齐备）。
- 待办：①网关恢复后重采一轮 → G-CORE-02 终判（click 重试验证）；②G-CORE-03 判定通道待用户指定（LLM 判定代理因被测页面时政内容触发 provider 输出过滤，无法出判定书；机械 digest 证据链已备齐——四判据布尔/哈希在案）。
## 环境重建事故与回归轮（2026-11-11 上午，终判后）

**事故（非门禁运行）**：上一代 dsh（02:40 世代）残留占 50454 端口 + `gate-boot.log` 为追加模式（旧 `dsh web:` 行留存）→ gate-setup boot 循环匹配旧行假就绪退出、新 dsh 因端口占用崩死 → gate-run 以新凭据登录旧 dsh 报「账号或密码不正确」。处置：杀残留进程、清 boot log 与 gate-env.json、完整重跑 gate-setup。教训已入 gate-setup 运维口径（boot 循环应校验行时间戳或启动前清 log）。

**前端引导链路（用户确认实现，随 E1 交付）**：
- relay 三端点实测：`GET /companion/download.zip`（200，application/zip，6298B，4 文件；`--zip` CLI 通道传入包路径，缺省 404 文本）、`GET /companion/guide`（200，三态自检页——同源轮询 /api/status 渲染 已连接/未连接/失败 + 安装步骤 + 企业策略分支文案）、`GET /api/status`（CORS `access-control-allow-origin: *`）。
- 报错引导闭环：扩展未连接时 browser 工具报错文案附指引页 URL（模型转告用户）；`classify()` 保留业务 code（NO_EXTENSION/NO_TAB），不再被 TOOL_ERROR 兜底覆盖。
- zip 打包修复：extension-companion build.mjs 曾因未导入 `rmSync`（ReferenceError 被 `catch {}` 静默吞）不出包；修复后 esbuild+zip 一体产出。zip 产物入 .gitignore。
- 探测形态裁定：**不**给扩展加全页 content-script DOM 标记（红线 8 最小权限）；引导页自检走同源 /api/status 已闭环。会话内 settings.section 插件分区（三态横幅完整版）归 E2.5-T4。

**回归轮（终判后环境重建首采，回归一致性——非门禁判定）**：G-CORE-01/02/03 三用例全链真跑：G-CORE-02 序列 snapshot→fill→snapshot→click 全零错误（fill 触发站点自动提交→模型按纪律分支①重新 snapshot 取新 ref 再 click 成功，orderSubsequence=true；click 为本会话终点、落点验证走 click 回执 url/title——与终判轮「click 后快照」形态差异，登记不阻断）；G-CORE-03 纯 snapshot→click→snapshot 三步零错误、ref e230 点击前快照在案、openedTabs 上报详情页（ithome.com/1/024/864.htm）、判据 2 基准首段 77 字符逐字符包含一致（指纹 77ch:9ef6b2a6）、无 content_filter、turnFailed=false。digest 证据：smoke/gate-evidence/regression-2026-11-11/（2026-11-11 上午批次；终判轮原始工件未被覆盖——回归批次独立目录，tracked 终判工件经 git checkout 恢复）。

## 生产落地（2026-11-11 上午，用户指令：功能完整生产部署）

链路：PR #9/#10（引导链路+生产落地）→ PR #11/#12（dsh-mcp-client 钉同族 alpha.3）→ PR #13/#14（egress companion 豁免）→ main=ec91ae9 → 干净 worktree 构建镜像 → 容器重部署 healthy。

**生产实测抓到并修复的两个阻断**（均为验收环境覆盖不到的生产实跑发现）：
1. **dsh-mcp-client 版本族**：rc.1 被 dsh@0.2.2-alpha.3 内核静默 disable（requirements 整组 rc.1 包不匹配）——「@deepseek-ai 须同版本」老坑的版本族变体；改装同族 0.2.2-alpha.3 后零拒装、容器内 MCP initialize+tools/list 三工具全通。
2. **egress 语义错位**：mimo-pro 调 browser_snapshot(url=example.com) 被域名白名单（3 条内网规则）拒——mcp__browser__* 的 url 参数=用户浏览器导航目的地（出站在用户机器），被当服务端出站审计。修复=egress 加 exemptToolGlobs（缺省豁免 mcp__browser__*，配置可收窄；extra 17+glue 25 测试）。

**生产端到端终验（公网入口真实会话）**：模型按纪律调 mcp__browser__browser_snapshot → relay 回 NO_EXTENSION+指引页 URL → 模型完整转告用户（原因+三步安装操作+「告诉我已连接我会重试」）——工具面挂载与引导报错链路在生产同时坐实。verify.sh 10/10（9310 三项真·生产容器——第一轮 verify 曾误打本机残留验收 relay（127.0.0.1 优先命中），清场后复验）。

**运维待办（公网形态两步，用户操作）**：① .env 设 `ETERNA_RELAY_PUBLIC_URL=wss://eternity-electricity.cn:3210/relay/extension`；② DSM 反代加 `/relay` → `本机IP:9310`（WebSocket 开）——guide 页/报错文案即按公网地址展示（当前展示 127.0.0.1:9310，仅本机/局域网形态可用）。token：`docker exec eterna-agent cat /data/relay-token`（或 .env 设 ETERNA_RELAY_TOKEN）。

**外网形态打通（2026-11-11，用户配完 DSM 反代后全链验证通过）**：
- 方案修正：DSM 反代规则来源只有 协议+主机名+端口（无路径字段），`/relay` 路径前缀方案在 DSM 上不可行（公网 404 来自 DSM nginx）→ 改为**独立端口规则**（来源 `HTTPS/*:9310` → 目的地 `HTTP/192.168.31.44:9310`，与既有 eternaAgent 3210 规则并存）+ 公网防火墙放行 9310；`.env` 改 `ETERNA_RELAY_PUBLIC_URL=wss://eternity-electricity.cn:9310/extension` 后 up -d 重渲染。
- 公网四项全过：guide 200 / download.zip 200(application/zip 6298B) / wss 无 token 401 / wss 带 token 连接成功——token 鉴权在公网生效（红线 9）。
- **验证工装坑**：node ws 客户端对 wss 未显式声明 ALPN 时可被 TLS 协商成 HTTP/2→upgrade 404（假阴性）；`ALPNProtocols:['http/1.1']` 或 `curl --http1.1` 才是真实验证姿势——浏览器扩展用原生 WebSocket（强制 http/1.1）不受影响。

## 多用户并发 + 前端令牌卡（2026-11-11 下午，产品要求"必须支持多并发"）

链路：PR #19/#20（relay 多用户+access 令牌基建+UI 卡）→ PR #22/#23（cli --tokens-file 生产实测修复）→ main=ce32131 → 干净 worktree 重建部署 healthy（镜像 4a52ef9f5b8b）。

**多用户架构**（产品硬性要求落地）：
- relay 扩展腿按「凭据串=命名空间」多路复用：每 token 一台浏览器，tabs/sessions/ref 注册表全隔离；同令牌二接入 409（token=浏览器实例身份），不同用户完全并行
- 身份路由链：dsh 会话（exec.agent.session.id）→ sessions 表 owner（access 既有）→ companion-tokens.json 用户令牌 → 对应扩展连接；注入点=access 的 tools/pre-execute 瀑布末段（服务端覆盖 _eternaToken，模型不可伪造；晚于治理/审计=治理面不接触令牌）；已知归属未生成令牌 → deny（fail-closed）
- /api/tools 凭据校验（x-relay-token）——回闭公网反代透传暴露的上一轮缺口

**前端令牌卡**（设置→账号→浏览器执行面，全用户可见）：令牌等宽展示+一键复制+生成/重置两击确认+安装指引新窗跳转（guideUrl 由 ETERNA_RELAY_PUBLIC_URL 推导）。

**生产 API 层全链验证**（公网入口 admin 会话）：初始 token=null → reset 生成 ec- 令牌 → view 命中 → 清单文件 /data/access/companion-tokens.json 落盘（0600）→ relay 直读认证（用户令牌 ws 接入+/api/tools 200）→ guideUrl 公网推导正确；verify.sh 10/10。

**生产实测修复**：cli.ts 未接 --tokens-file（server 选项已备 CLI 漏接→清单恒空全 401）——集成测试直构 RelayServer 未盖 CLI 解析面的盲区。

**阻塞登记（并行会话迁移中间态，非本工作范围）**：
1. 新镜像含用量统计插件改造（侧栏重排：用量统计/更多/工作区）——**「⚙ 设置」入口在侧栏消失**（DOM 扫描 60+ 交互元素无设置项；头像/⌘,/右侧栏/更多浮层均无）→ UI 卡生产可见性阻塞（深浅主题截图挂账）。卡本身已交付（bundle 含 CompanionCard），等设置入口恢复即可见。
2. **历史会话全部报 `no adapter registered for provider "litellm"`**（P2 多供应商直连迁移摘除 litellm 后既有会话模型路由失效）——本会话早前 MCP 探针（14:40 之前）的会话正常，之后全失败。
