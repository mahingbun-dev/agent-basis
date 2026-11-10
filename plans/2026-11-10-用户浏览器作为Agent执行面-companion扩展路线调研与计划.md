# 把用户的浏览器作为 Agent 执行面：Companion 扩展路线调研与计划

- 日期：2026-11-10
- 状态：调研与考证完成。方案为候选，D9–D13 决策点经用户裁决后立项
- 命题（用户提出）：eterna 是 web 企业 agent，用户本来就在自己的浏览器里访问它；再加一个"内置浏览器"（服务端 sidecar）有点多此一举。能否**直接操作用户的浏览器**，把用户的浏览器当作内置浏览器，天然复用登录态？
- 与 v2 计划书的关系：本篇是 `plans/2026-11-09-内置浏览器体验与性能优化调研与计划.md` 的**路线修正案**。考证结论支持本路线为主执行面，v2 的 sidecar 方案降级为兜底（详见 §8 关系修正）。

---

## 0. 结论先行

**命题成立，而且恰好是 2026 年业界收敛的主力路线。** 八条关键发现：

1. **技术成立**：`chrome.debugger` 扩展 API 官方明文的 CDP 域白名单覆盖了 agent 所需的一切——`Accessibility`、`Input`、`DOM`、`DOMSnapshot`、`Runtime`、`Page`、`Network`、`Target`、`Emulation` 等；`Input.dispatchMouseEvent/KeyEvent` 产出 **isTrusted=true 的可信事件**（Puppeteer 走同一协议，官方 FAQ 明文）。
2. **先例收敛**：行动通道业界已收敛到"扩展经 chrome.debugger 走 CDP"——Playwright MCP extension 模式、Perplexity Comet、Midscene、nanobrowser v0.2、OpenClaw 全部如此；Claude for Chrome 是唯一走 content script 合成事件的例外，而它恰恰出了 ClaudeBleed 劫持事件。
3. **协议同构**：Playwright MCP extension 模式是"两个对称 WS 端点的中继"（`/cdp/` 给自动化端、`/extension/` 给扩展端），与部署位置无关——把本地 loopback server 换成 `wss://relay.eterna…` 协议上成立。rtrvr.ai 已商用验证"云端驱动用户扩展设备"的最同构形态。
4. **企业分发红利（本考证最大的发现）**：`ExtensionSettings.force_installed` 策略强装 = 权限**隐式授予免弹窗** + 用户**不能禁用**，且 **Chromium 源码级豁免 debugger 黄条**（`debugger_api.cc`："We allow policy-installed extensions to circumvent the normal infobar warning"）——普通安装的两大 UX 障碍（安装警告、运行时黄条可被用户点 Cancel 杀死会话）在企业场景直接消失。
5. **出站面红利**：浏览发生在用户侧，页面数据经既有的模型调用通道上行——**不新增服务端公网出站面**。v2 的立项前提 D1（放开第二出站面）只在 sidecar 兜底路线落地时才需要。
6. **登录态（用户直觉的方向性正确）**：登录态就在用户浏览器里，天然复用；且 Chrome 正在推广 **DBSC（设备绑定会话凭据）**，"导出 cookie 播种服务端浏览器池"的路线正被结构性封杀，而"同设备 CDP 操作"不受影响——**扩展路线顺应平台趋势，v2 的 sidecar-承载登录态方向逆势**。
7. **覆盖面**：Chromium 系（Chrome/Edge/Brave 共享策略体系）一等支持；Firefox 无 debugger 等价 API（CDP 已移除）、Safari 需原生 App 壳——明确 Chromium-first，其余回落 sidecar/tool-web。
8. **主要代价**：断线是常态而非异常（用户点黄条 Cancel / 对同一 tab 开 F12 / 关浏览器 / 扩展更新，都会断开会话）——必须内建会话恢复与优雅降级；WAN 下每个工具一次往返；扩展本身的开发与分发成本。

---

## 1. 技术可行性考证

### 1.1 chrome.debugger（扩展内逐 tab CDP）

【官方文档，developer.chrome.com/docs/extensions/reference/api/debugger，2026-11-05 版已核读全文】

- **CDP 域白名单原文**："The available domains are: **Accessibility**, Audits, CacheStorage, Console, CSS, Database, Debugger, **DOM**, DOMDebugger, **DOMSnapshot**, **Emulation**, Fetch, IO, **Input**, Inspector, Log, **Network**, Overlay, **Page**, Performance, **Runtime**, Storage, **Target**, Tracing, WebAudio, WebAuthn."
  - 感知用 `Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot`、动作用 `Input.*`/`DOM.*`、脚本 `Runtime.evaluate`、导航截图 `Page.*`、抓包 `Network.*` 全部可用；`Target` 域也在白名单内（官方文档自带 `Target.setAutoAttach` + flatten 示例，OOPIF 可经 Chrome 125+ flat sessions 子会话处理）。
  - 注意：attach 的是 tab 级 target，不是 browser-level session——拿不到 Browser 级域。
- **已知坑**（实施时逐条对位）：
  - `Accessibility.getFullAXTree` 需先 `Accessibility.enable`，且可访问性模式可能未激活（首调返回空树是常见坑）【社区转述】；
  - Chrome 148+ `getFullAXTree` 需要 `frameId`，否则只返回根节点【社区转述，待实测复核】；
  - chrome:// 页面、Web Store、其他扩展页不可 attach（"Cannot attach to this target"）；Google Docs/Drive 有 attach 失败案例【社区转述】；
  - **DevTools 冲突**：用户对已 attach 的 tab 开 F12 → `onDetach`（官方明文）；反向亦然（一个 target 同时只能一个 debugger 客户端）——"用户随手开 F12 就断线"必须按常态处理；
  - 黄条 Cancel → `canceled_by_user` detach。
- **可信输入**：MDN 定义 isTrusted 不可伪造；Puppeteer 官方 FAQ "All input events generated with Puppeteer are trusted"（同一 CDP Input 域）。【官方文档+一手】

### 1.2 MV3 Service Worker 生命周期与长连接

【官方文档】

- SW 空闲 30s 终止；单事件处理超 5 分钟终止；**Chrome 110 起移除了总寿命 5 分钟硬上限**（官方博客原文）；**Chrome 116 起 WebSocket 收发消息重置 30s 计时器**（官方 how-to 直接给出"SW 持 WebSocket + 每 20s keepalive"的示例代码）；**Chrome 118 起"chrome.debugger 活跃会话本身保持 SW 存活"**（官方原文）。
- offscreen document 无寿命限制，但**只允许调 `chrome.runtime` 一个扩展 API**——不能直接调 chrome.debugger；可作"wss 韧性层"（offscreen 持连接，经 runtime messaging 唤醒 SW 执行），SW 直持 wss 仍是首选（少一跳）。
- 工程要点：SW 全局变量即失忆，状态落 `chrome.storage.session`；SW 启动时按存储状态重 attach；扩展更新/浏览器重启 = 连接与 attach 全断，服务端需支持会话恢复与指令幂等重放。
- wss 从 SW 或 offscreen 发起在网络层面完全等价（用户浏览器内的出站 TLS，NAT 友好），差异只在生命周期归属。

### 1.3 弱权限替代模式（content-script-only）能力边界

| 能力 | content-script-only | chrome.debugger |
|---|---|---|
| DOM 读写 | ✔ | ✔（含 OOP iframe） |
| 点击/键盘（React 等合成事件） | ⚠️ isTrusted=false，React 17+ 事件委托可响应 | ✔ 可信事件 |
| 文件上传 | ⚠️ DataTransfer 注入 + 绕 value tracker | ✔ `DOM.setFileInputFiles` |
| 原生拖拽/风控站点 | ✗ | ✔ |
| a11y 树 | ✗（只能 DOM 自建近似） | ✔ CDP 官方 AX 树 |
| 截图 | ⚠️ captureVisibleTab 仅可视区 | ✔ 可全页 |
| 网络观测 | ⚠️ fetch/XHR hook 易被检测 | ✔ Network.* |

结论：弱权限模式可作 strict 企业的降级运行模式，但企业强装场景下（免弹窗+免黄条）没有理由不打满 chrome.debugger。

### 1.4 cookies 与"登录态播种"——不要做

- 扩展（host permission + cookies 权限）**能读含 httpOnly 的 cookie**，但只限有 host permission 的域；CHIPS 分区 cookie 需主动遍历 `partitionKey`（Chrome 119+）。【官方文档】
- **DBSC 击穿**【官方文档】：设备绑定会话凭据把会话 cookie 与设备安全硬件私钥绑定（短寿命+签名 challenge 刷新），偷走的 cookie 在别处无法刷新；Chrome 已在 Windows 上线、Google Workspace 可强制启用。CSA 研究同时指出 **CDP 在同一设备上可绕过 DBSC**——"在用户浏览器里操作"可行，"导出到服务端"不可行。
- 其余坑：token 在 sessionStorage/IndexedDB/memory 拿不到；Entra Conditional Access 等设备绑定 SSO 拒绝回放；IP/指纹差异风控。
- 区分：ego-browser 的 `import --browser chrome` 是**同机 profile 迁移**（本机 ego lite 吸收本机 Chrome），性质不同，不适用于"用户浏览器→NAS 服务端"的跨设备场景。
- **结论：登录态复用必须绑定"就在用户自己的浏览器里做"。任何 cookie 导出播种服务端浏览器池的设计都是一条正被 Chrome 关闭的路。**

### 1.5 chrome.sidePanel

【官方文档】Chrome 114+；`sidePanel.open()` 只能在用户手势中调用（agent 不能随时程序化弹开）；面板跨 tab 常驻、拥有全部扩展 API。典型组合：**sidePanel 做 agent 对话/审批台 + content-script overlay 做页内动作光标/高亮**。

---

## 2. 企业分发与合规考证

### 2.1 分发路径（推荐：商店 unlisted 包 + 企业策略强装双轨）

- **`ExtensionSettings`**（Chrome 62+，supersedes 旧 Forcelist【一手 Chromium policy YAML】）：逐扩展 `installation_mode: force_installed` + `update_url`；force_installed = **静默安装、用户不能卸载或关闭、权限隐式授予免弹窗**。可用特殊键 `*` 全局默认 + ID 覆盖，支持 `runtime_allowed_hosts / runtime_blocked_hosts / toolbar_pin / minimum_version_required` 等。
- 自托管 CRX 分发可行（gupdate XML + CRX v3 + HTTPS codebase），但 **Windows/macOS 上非商店源的强装要求设备已 AD/AAD 域加入或 CBCM/MDM 纳管**【一手 Chromium policy YAML】——商店包（哪怕 unlisted）无此前置、由 Google 承担签名与更新分发，是更顺的主路径；自托管 CRX 作为不进商店客户的备选。
- Edge 同名策略（`ExtensionInstallForcelist`/`ExtensionSettings`，ADMX `Microsoft Edge/Extensions`）几乎逐字复用 Chromium 条款【官方文档】；Brave 继承 Chromium 策略体系【官方帮助+一手 issue】。
- **Debugger 黄条豁免（源码级证据）**：普通扩展 attach 显示黄条且用户点 Cancel 即断会话；**策略安装（policy location）的扩展被源码豁免**——Chromium `debugger_api.cc` 注释："We allow policy-installed extensions to circumvent the normal infobar warning"（suppress 条件：`--silent-debugger-extension-api` 开关 或 `Manifest::IsPolicyLocation`）。【一手】这是"IT 可控 + agent 免打扰操作浏览器"能同时成立的唯一官方组合。
- 审计：客户 IT 侧有 Admin console 的 **Apps & extensions usage 报告**（每用户/设备的扩展、版本、权限、来源，可 CSV 导出）【官方文档】；Chromium 源码已出现 `ENTERPRISE_CDP_ATTRIBUTION` 构建特性（CDP 会话 actor 归因）——平台在为"谁在用 CDP"铺审计【一手】。

### 2.2 政策与限制要点

- **命名纠正**（修正 v2 调研的口误）：管 `--remote-debugging-port` 的策略是 **`RemoteDebuggingAllowed`**（不是 DevToolsRemoteDebuggingAllowed）；`DeveloperToolsAvailability` 默认值 0 只禁止 inspect"策略安装的扩展自己的页面"，**不阻止企业强装扩展对普通网页 attach**（源码注释："This policy only restricts extensions and web apps. Regular pages are allowed."）【一手源码】。
- **⚠ Chrome 155–158 已知 bug + Edge 154+ 既定行为**：对含 debugger 权限的扩展配置 `runtime_blocked_hosts` 会**全局废掉 chrome.debugger.attach()**【一手 policy YAML / Edge 官方文档】→ 客户配置指南必须写明：对我们这条目用 `runtime_allowed_hosts` 反向放行，不要配 `runtime_blocked_hosts`。
- **MV3 远程代码（RHC）边界**【官方文档】：政策明文 "It does not include data or things like JSON or CSS"——**从自家服务器拉取 JSON 指令/配置=数据=合规**；执行任何远端 JS/WASM=违规且 MV3 CSP 技术上就不可行。且 RHC 迁移指南把 **chrome.debugger/CDP 列为官方许可的豁免通道**——本架构在政策面是"正面教材"。
- debugger 权限**不可做成 optional**（官方不支持 optional 的权限清单明文含 "debugger"）；host 权限可以 optional 化按站点授予（`optional_host_permissions` + 用户手势 `permissions.request()`，Chrome 133+ `addHostAccessRequest()` 支持 per-tab 持久授权）【官方文档】。
- 无痕模式：无逐扩展强制进无痕的策略（Forcelist 明文不适用 Incognito）【一手+负向查证】；产品将 incognito/chrome:// 列为不可操作目标（与 OpenClaw 同款边界）。

---

## 3. 先例架构横切（9 个实现考证）

| 实现 | agent 循环在哪 | 行动/感知通道 | 传输 | 登录态 | 对本产品的关键启示 |
|---|---|---|---|---|---|
| **Playwright MCP `--extension`** | 本地 MCP server | 扩展 chrome.debugger→CDP；**CDP↔chrome.* 双向翻译器**（BrowserModel） | 两个对称 WS：`/cdp/<uuid>` + `/extension/<uuid>`；loopback；uuid+明文 token 或每次手动批准 | 用户真实 profile | **协议与"远端 wss 中继"完全同构**——服务端经中继用 playwright-core `connectOverCDP` 拿全部 Playwright 能力（ai 快照/ref/actionability）；tab group 圈定受控范围；20s ping 保活（一手源码） |
| **chrome-devtools-mcp `--autoConnect`** | 本地 MCP server | CDP（Chrome 144+ 官方审批 UI：`chrome://inspect/#remote-debugging` 开关+每连接弹窗） | 本机调试通道（loopback） | 当前默认 profile 全部窗口 | Chrome 官方在为"用户审批后的调试授权"标准化铺路——平台方向印证本路线；纯 web 服务端不能直接用，但**审批 UX 语言**值得抄 |
| **Claude for Chrome** | **云端**（Cowork session） | content scripts + javascript_tool + 截图坐标（**无 debugger**） | 扩展→Anthropic API（细节未公开）；本地 native host 仅桥接桌面版 | 用户会话内执行 | 权限三层（站点级授权存扩展 storage + 每步确认 + 双分类器）可借鉴；**但 content-script 路线出了 ClaudeBleed**——反面参照 |
| **Perplexity Comet** | **云端** | chrome.debugger→CDP：AX 树→YAML+ref 寻址；ComputerBatch 坐标批量/FormInput | **双通道**：SSE 编排 + 扩展直连 `wss://www.perplexity.ai/agent`（地址动态下发） | 独立浏览器自有 profile | 双通道拆分 + AX-YAML 感知省 token + 扩展内硬边界函数 + managed storage 下发黑名单 |
| **nanobrowser** v0.2 | **扩展内**（BYOK） | chrome.debugger+内嵌 Puppeteer：元素 ID 化、真实输入、动作前校验 | 无远端 | 用户 profile | "确定性控制层"协议 = 云端 agent↔扩展执行器的消息协议样板 |
| **Midscene** bridge 模式 | 本地 Node | chrome.debugger | Node 起 WS `127.0.0.1:3766`；扩展弹 Allow/Always Allow；**远端模式文档化（0.0.0.0，无内置鉴权）** | 桌面 Chrome 全量 | 唯一官方跨机器 bridge 文档——**反面鉴权教材**；plan+定位双缓存+HTML 报告回放可平移 |
| **rtrvr.ai** | **云端**（mcp.rtrvr.ai） | 扩展执行（通道未披露） | 扩展注册为云端 **device**：lastAckAt + 15 秒拾取窗口 + 503 | "Runs in your own signed-in Chrome" | **与本产品最同构的商用先例**；device 注册/ack 语义可抄，"15s 硬败"是要避免的反面（需优雅降级）；URL 内嵌 apiKey 是反模式 |
| **browser-use** `from_system_chrome` | 本地 Python | Playwright→CDP，**以真实 profile 目录启动**系统 Chrome | 无 | 真实 profile（需先关 Chrome，profile 锁） | 其局限（锁 profile、关浏览器）反向印证扩展路线的优势 |
| **OpenClaw** 扩展 | 本地 Gateway | chrome.debugger | native messaging 引导 + loopback relay；**鉴权=16B nonce+连接绑定 HMAC**，密钥不出现在 URL/header/帧 | 用户已登录 profile 的 eligible tabs | **鉴权工程最佳实践**；**tab group 即授权边界**（移入=授权/移出=撤销）；排除 incognito/chrome:// |
| **ZCode 扩展后端**（本机插件文档） | 宿主进程 | playwright 语义 API | 宿主桥 | 用户 tab 融合 | **user.openTabs() → claimTab(info)** 的用户 tab 认领协议 + "两列表组合观察"纪律——扩展路线的协作语义直接蓝图 |

**三条结构性结论**：
1. 行动通道已收敛到 chrome.debugger（8/9），感知收敛到 AX 树+ref（比截图省 token 且可校验）。
2. "云端编排 + 扩展执行器 + wss/设备语义"已被 rtrvr（商用）与 Playwright MCP relay（开源、协议完整公开）双重验证；我们的差异点是**企业分发**（强装+豁免黄条）与**既有 eterna-access 鉴权融合**。
3. 四个公开反面教材必须规避：无鉴权本地 IPC（Claude native host）、无签名权限表（同）、裸奔远端 bridge（Midscene）、URL 内嵌密钥（rtrvr）。

---

## 4. 安全教训与设计红线

来自 ClaudeBleed（LayerX 2026-05 / Manifold 2026-07 一手报告）的具体缺陷：

- **onboarding/UI 按钮处理器不检查 `event.isTrusted`** → 任意有内容脚本权的恶意扩展可合成点击触发特权任务（"Act without asking" 模式下 CVSS 9.6）。**我们的红线：扩展内所有 UI 事件处理器一律 `if (!e.isTrusted) return;`**（一行代码的教训）。
- **URL 参数特权模式**（`?skipPermissions=true` 即进无审批模式）→ **我们的红线：不存在任何 URL/参数可达的权限旁路**。
- Anthropic 修复"只改了能问什么，没改谁能问"——授权模型必须绑定"谁"（eterna-access 会话身份）而非"问了什么"。
- 站点级授权存储要防篡改（Claude 的 per-domain 表在 LevelDB 明文无签名）；敏感动作（凭据输入/支付/删除/下载执行）默认禁止清单——沿用 v2 §7 门控分级。
- 页面内容一律 untrusted；注入防御沿用 v2 §7（prompt 硬规则 + M-级分类器可选）。
- 扩展最小权限：`debugger, tabs, tabGroups, storage, alarms, scripting` + **最小 host_permissions**（其余站点走 optional 授权）；对自家 UI 处理器做 isTrusted 校验；审计日志（服务端留存工具调用+站点+时间；扩展端本地镜像）。

---

## 4A. 浏览器兼容性校验与降级策略（增补，2026-11-10）

> 需求（用户）：为功能正常，需对用户的浏览器类型/版本做校验；不能完全支持的浏览器要在页面做出提示，并有对应降级策略。

### 4A.0 判定原则（三层）

1. **安装硬门槛**：manifest `minimum_chrome_version`——官方唯一硬机制：低于门槛 Web Store 直接 "Not compatible" 拒装、已装老用户**停止接收更新**（含企业 ephemeral 模式用户，写入 IT 指南）【官方文档】。
2. **运行时能力探测**（权威）：特性检测优先于版本号（MDN 官方立场；Chrome 官方对扩展的建议正是"minimum_chrome_version 硬地板 + 运行时特性检测"组合【官方 lifecycle 页】）。扩展在 **relay 握手时上报 capability manifest**，服务端按 manifest **裁剪工具面**（不支持的能力在调用前隐藏——ZCode manifest 式裁剪）并驱动页面提示。
3. **策略/环境感知**：企业管控状态可被扩展免权限感知——`chrome.management.getSelf()`（无需 management 权限【一手 management.json】）取 `installType: admin/normal/development/sideload`；attach 错误文案区分三类策略阻断（见 4A.4）。

### 4A.1 版本门槛总表（已核实，2026-11-10 基线）

| API/行为 | 门槛 | 影响 |
|---|---|---|
| MV3 本体 | 88 | 技术下限 |
| `optional_host_permissions` / `storage.session` | 102 | 按站点授权 / 会话内状态 |
| `chrome.offscreen`（单实例） | 109 | wss 韧性层 |
| SW 收发 WebSocket 消息重置空闲计时器 | 116 | wss 保活 |
| sidePanel 本体 114 / `open()` 116 | 114/116 | agent 侧栏 |
| **chrome.debugger 活跃会话保持 SW 存活** | **118** | 长任务稳定性分水岭 |
| alarms 最小间隔 30s | 120 | 保活补偿手段 |
| **debugger flat sessions（OOPIF 子会话）** | **125** | 跨进程 iframe 内页操作 |
| **`addHostAccessRequest`（per-tab 持久授权）** | **133** | 免弹窗站点授权的顺滑形态 |
| sidePanel `getLayout` 140 / `onOpened` 141 / `onClosed`+`close()` 142 | 140–142 | UI 增强，一律 feature-detect |
| ~~"148+ getFullAXTree 需 frameId"~~ | **证伪** | 协议中 frameId 一直 optional；148 的真实变化是 `browser.*` 命名空间【一手协议 JSON】 |

基线事实：Chrome stable **自 153 起改为 2 周一版**（当前 stable 157、158 灰度中）；企业 Extended Stable 8 周一版（当前 **156**）；Edge 与 Chromium 版本一一对应（Edge 157 同步 stable）【官方】。Android 消费端无扩展入口（企业 `android:146-` 强装策略已入 Chromium policy YAML【一手】但消费者场景未开放）；iOS 全系 WebKit 无扩展【官方】。

### 4A.2 版本分层（建议线）

| 层 | 版本 | 机制 |
|---|---|---|
| **hard floor（不装）** | `minimum_chrome_version: "120"` | <120 缺 alarms-30s，SW 保活不可靠；官方机制直接拒装 |
| **degraded（可装，受限）** | 120–132 | 缺 `addHostAccessRequest` → 站点授权退化为 `permissions.request()` 手势弹窗；缺 sidePanel 布局感知 → UI 简化。逐项提示 |
| **full（全功能）** | ≥133 | 140+ 的 UI 增强用 feature-detect gate，不设版本线 |
| **未验证版本** | 低于"当前 stable −4 个大版本"（覆盖 ES 节奏） | 黄标"未验证版本"，不拒绝 |

### 4A.3 浏览器类型判定顺序

1. SW 内 `navigator.userAgentData` 缺失 → **非 Chromium**（Firefox/Safari 均不实现 UA-CH【MDN BCD】）→ L0；
2. 读 `brands` 识别：`Microsoft Edge` / `Opera` / **`Brave`**（注意：Brave 的 UA 字符串伪装成 Chrome，UA 层无法判 Brave，只能靠 brand【多方一致】）；
3. UA fallback token：`Edg/`、`OPR/`（UA 缩减只冻结 minor/build/patch，brand token 不受影响）；
4. Android/iOS → L0（提示不支持，指引用桌面浏览器或 sidecar）；
5. 其余 Chromium 分支（Vivaldi/Arc 等）→ 标"未测试，可尝试"（nanobrowser 先例：明说 Chrome/Edge 之外不测试【一手 README】）。

### 4A.4 能力探测清单（capability manifest，relay 握手上报）

```jsonc
{
  "backend": "debugger | contentScript",     // chrome.debugger 存在性 + attach 试探
  "installType": "admin | normal | development | sideload",
  "chromeVersion": "157.0.1234.56",          // getHighEntropyValues(["fullVersionList"])，
                                             // SW 内可用(WorkerNavigator 90+)；144+ 受
                                             // ch-ua-high-entropy-values permissions policy 管控
  "browserBrand": "chrome | edge | brave | opera | chromium-other",
  "flatSessions": true,                      // ≥125，OOPIF
  "sidePanel": { "api": true, "open": true, "layout": true },   // 114/116/140
  "hostAccessRequest": true,                 // ≥133
  "keepaliveTier": 118,                      // <118 需 offscreen/主动保活补偿
  "policyBlocked": null | "runtime_blocked_hosts" | "strict_restrictions" | "screenshot_dlp" | "devtools_availability",
  "screenCapture": "cdp | captureVisibleTab | none"
}
```

`policyBlocked` 由 attach 错误文案匹配判定（官方/一手文案）：
- `"This page cannot be scripted due to an ExtensionsSettings policy."` → `runtime_blocked_hosts` 命中（含导航后强制 detach）；
- `"Host access is restricted by policy"` / `"Screenshot capture is restricted by policy"` → **M155 `ExtensionDebuggerStrictPolicyRestrictions`**（attach 时全有全无检查；**只打非受信安装，企业强装豁免**【一手源码 debugger_api.cc + 两篇独立文章核实】；`--disable-features` 过渡 flag 将在 Chrome 160 移除）；
- DeveloperToolsAvailability=2 → "Cannot attach to this target"。

### 4A.5 降级阶梯

| 层 | 条件 | 行为 | 页面提示（四态徽标+横幅） |
|---|---|---|---|
| **L0 不支持** | 非 Chromium / Android / iOS | 浏览器工具从工具面**整体摘除**（调用前隐藏）；仅 tool-web | 🔴 红："当前浏览器不支持浏览器自动化"，附桌面 Chrome/Edge 引导与企业 IT 指引链接 |
| **L1 未装扩展/离线** | 握手无 manifest | 自动路由 **T2 sidecar**（若配置；提示"服务端浏览器执行，登录态不可用"）否则 tool-web | 🔵 蓝："安装 companion 扩展可复用你的登录态"（附安装/策略指引） |
| **L2 策略受限** | `policyBlocked` ≠ null | 受管设备：给 IT 精确修复指引（见 4A.7 核对清单）；**默认不自动降级 content-script**（D14 裁决：无公开先例、自研成本高，先做明确报错+指引） | 🟡 黄："浏览器自动化被企业策略限制"，附分类错误码与 IT 指引 |
| **L3 旧版本** | 120–132 | 缺失能力逐项声明（如"此版本无法免弹窗授权站点，将按站点弹窗申请"）；工具面按 manifest 裁剪 | 🟡 黄：具体缺失能力列表 + 升级建议 |
| **L4 完整** | ≥133 且无策略阻断 | 全工具面 | 🟢 绿："已连接 · 完整能力" |

### 4A.6 页面提示实现（eterna web 端）

- **扩展在场探测**：扩展 content script 在页面 `document.documentElement` 打 DOM 标记 + 应答 ping 事件（或 `externally_connectable` 定向消息）→ 页面区分"未装 / 已装未连接 / 已连接"。
- **服务端预判**（未装扩展时）：UA-CH 低熵三件套由 Chromium 默认随请求发送（有无 `Sec-CH-UA` = 非 Chromium 信号）；`Accept-CH` opt-in `Sec-CH-UA-Full-Version-List` 拿完整版本；brands 识别 Brave/Opera/Edge。**manifest 到手后以 manifest 为准，UA-CH 只做预判。**
- **提示位置**：会话输入区上方横幅（四态）+ 浏览器工具卡片状态徽标 + sidePanel 首屏诊断卡（版本/策略/权限三行体检）。
- **工具错误码**：`policy_blocked / version_degraded / capability_missing` 等，模型与用户各自可读（对齐 ZCode 错误模型）。

### 4A.7 客户策略核对清单（写入 IT 指南，每条都有失败模式佐证）

1. `DeveloperToolsAvailability = 1` —— **强装扩展使用 chrome.debugger 的前提**，默认 0 即失效（UiPath/AkaBot/SO 同款多年稳定语义【官方 policy 页+三方运维文档】）；配合 `DeveloperToolsAvailabilityBlocklist`（≤1000 条 URL）与较新的 URL-allowlist 政策收窄范围。
2. `ExtensionSettings`：`force_installed` + `update_url` + `runtime_allowed_hosts` 反向放行；**不要配 `runtime_blocked_hosts`**（Chrome 155–158 变体开关全关时可全局废掉 attach；Edge 154+ 为既定全禁行为【一手 policy YAML+Edge 官方】）。
3. DLP/`DisableScreenshots` 影响截图类能力的说明（155+ 对非受信安装连 captureVisibleTab 也拦）。
4. `minimum_chrome_version` 与 ES 用户的关系说明（已装用户停更机制）。
5. 审计：Admin console Apps & extensions usage 报告开启。

---

## 4B. 目标体验定义（北极星场景 A-E）

> 用户在自己的浏览器里访问 eterna，agent 直接在**同一个浏览器**中完成任务——登录态天然共享，用户全程可见、随时接管。本节是开发计划与测试门禁的**场景基准**（2026-11-10 补入；场景源自本报告 2026-11-09 首版的 §4「目标体验定义（北极星）」，重写考证版时被遗漏，现按 companion 路线改写恢复）。

- **场景 A（自动化任务）**：用户在会话说"去内部系统把上季度报表下载下来"→ agent 在用户浏览器打开内部系统（已是登录态）→ snapshot 定位 → 填表筛选 → 触发下载，文件经会话 attachment 交付。
- **场景 B（网页探索）**：agent 在自己的标签（tab group 圈定）打开多页调研；用户全程可见 agent 的标签与动作，可直接操作任何页面，agent 检测到真实输入即让位（输入仲裁）。
- **场景 C（数据获取）**：agent 用 evaluate / 页内 fetch 批量抽取结构化数据、调用页面同源 API、下载文件，落 attachment 回传会话。
- **场景 D（快用三件套）**：用户在任意页面一键「截图到会话 / 正文到会话 / 前端代码到会话」，内容进 composer 且 agent 立即可引用。
- **场景 E（反向可见与接管）**：agent 的动作流、截图、抽取结果、下载文件在会话流直接可见；用户可随时在 sidePanel 旁观进度，接管（request_human_help 语义）后自行操作，完成后交还。

---

## 5. 推荐架构：统一工具层 × 双传输（扩展主 / sidecar 兜底）

```
┌─ 用户浏览器（Chrome/Edge/Brave）──────────────────────────────┐
│  companion 扩展 (MV3)                                         │
│   SW: wss 长连(20s keepalive) ←→ chrome.debugger(逐tab CDP)   │
│   sidePanel agent 台 + overlay 动作光标 + 站点授权 UX          │
│   状态: chrome.storage.session; tab group = 授权边界           │
└──────────────┬───────────────────────────▲───────────────────┘
        wss 出站(复用 eterna-access 鉴权)      JSON 指令帧(数据,合规)
┌──────────────▼───────────────────────────┴───────────────────┐
│ eterna 服务端                                                 │
│  ① 浏览器中继服务: 会话状态机(online/busy/offline)+指令路由     │
│  ② 统一工具层(ego-lite 风格 ~12 工具,a11y+ref 感知,           │
│     playwright-core 实现)──一次实现,两种传输复用               │
│      T1 扩展中继(主): 中继的 /cdp/ 腿 → connectOverCDP         │
│      T2 sidecar attach(兜底): 计划任务/未装扩展/非Chromium     │
│  ③ 审计 + 门控 + 注入防御(v2 §7 沿用)                          │
└──────────────────────────────────────────────────────────────┘
```

- **T1（主）**：扩展端实现"逐 tab CDP 帧转发 + tabs/target 枚举"的薄翻译层（参照 Playwright MCP BrowserModel 的公开实现，需核其许可证/适配），服务端 playwright-core `connectOverCDP` 接中继 `/cdp/` 腿——**感知（`ariaSnapshot({mode:'ai'})` + `getByRef()` + actionability）与工具实现全部在服务端完成一次，与 sidecar 传输共享**。扩展薄 = 审核面小、逻辑迭代不重发扩展。
- **T2（兜底）**：v2 sidecar 方案缩编——只服务计划任务/浏览器未开/非 Chromium 用户，**不再承担登录态主承载**（§1.4 结论）；此时才需要 v2 的 D1 出站面裁决。
- **T0**：tool-web 静态抓取不变。
- **协作语义**（抄三家之长）：agent 默认在自己的新 tab 工作（tab group 圈定=可视化授权边界，OpenClaw/Playwright 模式）；接管用户已开 tab 走 `claimTab` 式显式认领（ZCode 协议）；用户随时可直接操作（天然旁观+接管，这是本路线的天然优势）；用户对 agent 正在驱动的 tab 产生真实输入时 agent 暂停让位（content-script 输入监听仲裁，E3 实现）；sidePanel 显示计划/动作流/审批，overlay 渲染带 label 的动作光标（ego lite 机制）。
- **断线恢复**：服务端会话状态机（online/busy/offline）；detach 原因分类处理（`canceled_by_user`→提示用户重连；DevTools 冲突→提示关 F12；浏览器关闭→离线待命）；指令幂等 + 超时上报，**不学 rtrvr 的"15 秒硬败"**（优雅降级：转 sidecar 或挂起等用户回来）。
- **鉴权**：relay 连接复用 eterna-access 会话令牌；不做 URL 内嵌 key；扩展↔服务端配对参考 OpenClaw nonce+HMAC（若令牌之外再加设备配对）。

## 6. 实施计划（E0–E5）

- **E0 决策与骨架**（0.5 天）：D9–D13 裁决；扩展仓库立项（可入 agent-basis monorepo `packages/extension-companion` 或独立仓）；MV3 manifest + SW + wss 骨架。
- **E1 最小闭环**（3–5 天）：扩展端 chrome.debugger attach + CDP 帧转发；服务端中继 + playwright-core 接通；3 个核心工具（snapshot/click/fill）端到端；开发模式：扩展设置页填 relay URL（远端可用前先支持 localhost 调试）。验收：example.com 与 HN 真实快照+点击+登录态页面操作（如用户已登录的任一站点只读操作）。
- **E2 工具面收敛与稳定性**（1 周）：~12 工具全集（对齐 v2 §5.2 清单）；onDetach 分类处理/重 attach/storage.session 恢复；receipt（popup/dialog）；token 预算（快照 depth/字符上限）；错误质量对齐 ego（候选列表+闲置毫秒）。
- **E2.5 兼容性与降级层**（0.5 周，强制项）：manifest `minimum_chrome_version: "120"`；握手 capability manifest 上报（§4A.4 全字段探测）；服务端按 manifest 裁剪工具面；页面四态徽标+横幅与 sidePanel 诊断卡；三类策略阻断文案识别与 IT 指引映射。验收：Chrome 120/126/133/当前 stable × Chrome/Edge/Brave × {未装扩展, 装扩展+无策略, 装+DeveloperToolsAvailability=0, 装+runtime_blocked_hosts} 矩阵全覆盖，每格给出正确的四态之一。
- **E3 权限与协作 UX**（1 周）：optional per-site host 授权；tab group 授权边界与认领协议；用户输入仲裁（agent 让位）；sidePanel agent 台 + overlay 动作光标；站点授权存储签名；审计日志。
- **E4 企业分发与打通**（1 周）：Chrome Web Store unlisted 上架（debugger 用途披露、隐私表单、RHC 数据/代码边界说明）；客户 `ExtensionSettings` 配置指南（`runtime_allowed_hosts` 反向放行、避免 Chrome 155–158 bug 的写法、**`DeveloperToolsAvailability=1` 前提**、版本支持窗口说明，见 §4A.7 核对清单）；eterna-access 会话打通；安全白皮书（DLP 讨论、数据驻留）。
- **E5 sidecar 兜底缩编**（可选，1 周）：T2 传输 + 计划任务场景；此期落地才需要 v2 的 D1。

**与 v2 计划（M1–M5）的关系修正**：

| v2 项 | 修正 |
|---|---|
| M1 挂 playwright-mcp 快路径 | **降级为可选试验田**（验证工具设计/prompt 纪律），可跳过——扩展路线下感知与工具都由自研工具层承担 |
| M2 sidecar attach 登录持久 | **方向撤销**：登录态主承载改为用户浏览器（扩展）；sidecar 缩编入 E5 兜底 |
| M3 快用三件套 | **保留且变容易**：扩展端可直接"截图/正文/前端代码→会话"（在用户浏览器内本就有 DOM 权限与截图能力），挂点仍是 conversation 服务 |
| M4 noVNC 两轨合一 | **被本路线取代**：用户浏览器本身就是"两轨合一"的终极形态（用户与 agent 同一浏览器、同一登录态、天然互相可见） |
| M5 自研收敛工具层+稳定 ref/settle/diff | **保留，升级为 E2**——工具层在服务端、传输无关，两路线共用 |
| D1（出站面） | **仅 E5 sidecar 兜底需要**；扩展主线不新增服务端出站面 |

## 7. 决策点（待裁决）

- **D9（路线主裁决）**：采纳"companion 扩展"为浏览器能力第一执行面（hybrid：扩展主 / sidecar 兜底 / tool-web 静底）？
- **D10 分发**：商店 unlisted + 企业 `ExtensionSettings` 强装双轨（推荐）；是否同时维护自托管 CRX 备选？
- **D11 权限模型**：debugger（不可 optional，随包）+ 最小 host_permissions + 其余站点 optional 按需授予 + 客户侧 `runtime_allowed_hosts` 指引——按此执行？
- **D12 sidecar 兜底**：保留缩编版（计划任务/非 Chromium 场景）并明确**不做 cookie 导出播种**（DBSC 结构性死路）？
- **D13 三件套形态**：扩展路线下"截图/正文/前端代码→会话"由扩展端一键完成（推荐，所见即所得）还是保留面板端实现？
- **D14（增补）**：debugger 被企业策略阻断时，默认**明确报错+IT 指引**（推荐：无公开先例、成本低）还是同时实现 content-script 自动降级模式（能力边界见 §1.3 表，自研成本高）？
- **D15（增补）**：兼容线确认——`minimum_chrome_version: "120"` 硬地板、≥133 全功能、支持窗口"stable −4 大版本"（覆盖 Extended Stable 节奏）？

## 8. 风险登记

| 风险 | 等级 | 应对 |
|---|---|---|
| 断线常态（黄条 Cancel/F12/关浏览器/扩展更新） | 高（频率）| 会话状态机+detach 分类+幂等重放+优雅降级（转 sidecar/挂起）；E1 即内建 |
| Chrome 155–158 bug / Edge 154：runtime_blocked_hosts×debugger 全禁 attach | 中 | 客户指南强制用 runtime_allowed_hosts；版本兼容矩阵；上报 Chromium 进展 |
| 商店审核趋紧（debugger 深审、非企业安装扩展逐版本加锁） | 中 | 企业强装=trusted（源码级豁免）为主路径；unlisted+完整披露；host 权限 optional 化 |
| WAN 延迟（每工具一往返） | 中 | ego/ZCode 纪律（末帧快照、动作批内合并、最便宜观察）本就压往返数；实测后必要时扩展端合并小命令 |
| 用户浏览器被风控/反自动化 | 低 | 可信事件+同设备会话（DBSC 无碍）；不做打码；企业内网站点为主 |
| 扩展成为攻击面（ClaudeBleed 类） | 中 | §4 红线清单逐条落实；最小权限；审计 |
| Firefox/Safari 用户 | 低 | 明确 Chromium-first；其余走 sidecar/tool-web 并在 UI 说明 |
| BrowserModel 翻译层实现复杂度（OOPIF/flat sessions） | 中 | E1 只做主 frame 闭环，OOPIF 按 Playwright MCP 公开实现渐进对齐；许可证核验 |
| 企业环境策略组合拳（DeveloperToolsAvailability=0 默认、DLP、DisableScreenshots、runtime_blocked_hosts） | 中 | §4A.7 IT 核对清单 + 三类错误文案识别 + L2 提示分支；E2.5 矩阵验收 |
| M155 严格限制向受信安装扩散（未来版本风险） | 低-中 | 强装=ExtensionIsTrusted 豁免是源码级机制；跟踪 Chromium 变更；错误文案匹配已内建 |
| 老版本 Chrome 长尾（企业 ES 之外的滞留设备） | 低 | minimum_chrome_version=120 硬地板 + L3 降级提示；Web Store 拒装机制兜底 |
| 未测试 Chromium 分支（Vivaldi/Arc 等）行为差异 | 低 | 标"未测试"黄标；问题反馈通道；不承诺支持 |

## 附录 A：验证声明

- 【官方文档】chrome.debugger（含 CDP 域白名单原文）、MV3 SW 生命周期/WS keepalive/debugger 保活、sidePanel、cookies/DBSC、ExtensionSettings/Forcelist/DeveloperToolsAvailability、RHC 政策、optional 权限清单、Edge/MDN/Apple/Firefox 官方页。
- 【一手源码】Chromium：`debugger_api.cc`（policy 扩展豁免黄条）、`chrome_switches.cc`（silent-debugger switch）、`ExtensionSettings.yaml`/`ExtensionInstallForcelist.yaml`、`devtools_availability_checker.cc`、`incognito_info.cc`、`ENTERPRISE_CDP_ATTRIBUTION`；Playwright monorepo：`cdpRelay.ts`/`relayConnection.ts`/`connect.tsx`/`background.ts`；nanobrowser `browser-control/`；Midscene `page.ts`（chrome.debugger.attach）；Zenity/Claude 逆向与 Manifold 报告。
- 【实测】本机：ego-browser `help import`（同机 profile 迁移语义）；ZCode 插件 docs（tab-claiming/safety/overview）。
- 【转述/未证实】Comet WS 鉴权细节（未公开）；"Perplexity 控制浏览器扩展"动向（社区传闻）。
- 【增补轮 2026-11-10（兼容性专项）】版本门槛逐条经官方文档/MDN BCD/一手协议 JSON 核实（§4A.1 表）；"Chrome 148+ getFullAXTree 需 frameId"**证伪**（协议中一直 optional）；M155 变更经两篇独立文章核实为 `ExtensionDebuggerStrictPolicyRestrictions`（只打非受信安装），**不涉及 DeveloperToolsAvailability**；"强装扩展用 debugger 需 DeveloperToolsAvailability=1"为多年稳定语义（chromeenterprise policy 页 + UiPath/AkaBot/Stack Overflow 运维文档）；Chrome stable 2 周节奏（153 起）与 ES=156 经 chromestatus/release notes 核实；`management.getSelf()` 免权限、`minimum_chrome_version` 不装+停更行为经官方文档核实。

## 附录 B：主要来源

developer.chrome.com（debugger/permissions-list/service-workers-lifecycle/websockets/offscreen/sidePanel/cookies/host-extensions/activeTab/RHC/CWS 分布与隐私）、chromeenterprise.google/policies、Chromium policy YAML 与源码（chromium.googlesource.com / github.com/chromium/chromium）、learn.microsoft.com/deployedge、playwright.dev、github.com/microsoft/playwright（extension/）、ChromeDevTools/chrome-devtools-mcp docs、labs.zenity.io（Comet/Claude 分析）、manifold.security（ClaudeBleed Reopened）、malwarebytes/securityweek（ClaudeBleed 报道）、github.com/nanobrowser、midscenejs.com、rtrvr.ai/docs、docs.openclaw.ai、docs.browser-use.com、developer.apple.com/safariservices、fxdx.dev（Firefox CDP 移除）、developer.mozilla.org。
