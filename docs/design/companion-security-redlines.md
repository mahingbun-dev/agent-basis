# Companion 扩展安全设计红线清单（E0-T3，待用户签核）

> 依据：plans/2026-11-10-用户浏览器作为Agent执行面-companion扩展路线调研与计划.md §4「安全教训与设计红线」。
> 状态：**待用户签核**（签核后登记 acceptance/INDEX.md；签核前可作为实现参考，但验收索引不记为已定版）。
> 适用范围：packages/extension-companion（扩展端）与 packages/browser-relay（中继服务）全部代码与后续演进；行为级验证由协作与安全门禁组（G-UX-10/11/12/13）与总验收组承接。

## 红线（每条含失败模式出处，违反即打回）

1. **UI 事件处理器一律校验 `event.isTrusted`**：扩展内所有 UI（options 页、sidePanel、overlay）的事件处理器首行检查 `if (!event.isTrusted) return;`。合成点击不得触发任何特权路径。
   （出处：ClaudeBleed/Manifold 报告——onboarding 按钮不查 isTrusted 被合成点击触发特权任务，"Act without asking" 模式下 CVSS 9.6。）
2. **不存在任何 URL/参数可达的权限旁路**：任何 URL 参数、query、消息 type 都不得开启或跳过权限/审批模式；授权模型绑定「谁」（eterna-access 会话身份）而非「问了什么」。
   （出处：Claude for Chrome `?skipPermissions=true` 缺陷；Anthropic 修复"只改了能问什么，没改谁能问"。）
3. **页面内容一律 untrusted**：快照文本、ref 名称、URL、页面返回值只用于定位元素与呈现，永不作为指令执行；不把页面内容复制进 evaluate/跳转脚本；工具实现层把快照包装为数据。
   （出处：ZCode safety 契约同款；Anthropic/OpenAI 注入防御共识。）
4. **登录态不离开用户浏览器；明确不做 cookie 导出播种**：不实现任何 cookie/storageState 导出通道（DBSC 结构性死路，companion§1.4）；工具结果与日志中凭据字段（password/token/卡号）永不出现在明文。
5. **敏感动作默认禁止清单**：凭据输入、支付/金融交易、永久删除、下载后执行类动作默认禁止，如开放须显式审批流（E3）。
6. **密码框掩码 + 截图跳过**：识别 `type=password` 与 autocomplete 令牌（current-password/new-password/one-time-code/cc-*），截图与审计记录跳过或掩码。
7. **不可操作目标排除**：`chrome://`、`chrome-extension://`、Web Store、无痕窗口页面一律拒绝 attach/操作（OpenClaw 同款边界）。
8. **最小权限**：manifest 仅声明 debugger/tabs/tabGroups/storage/alarms/scripting + 空 host_permissions；站点访问走 optional 按需授予（E3）；扩展逻辑迭代不引入远端代码（RHC：远端只拉 JSON 数据/配置，永不拉取执行 JS/WASM）。
9. **中继鉴权绑定身份**：relay 连接复用 eterna-access 会话令牌（E4 落地，E1 localhost 开发模式豁免并明示）；不做 URL 内嵌密钥；错误信息不泄漏内部结构。
10. **审计留痕**：服务端留存每次工具调用+目标站点+时间（E3-T7 全量落地；E1 起控制台日志即含最小审计字段）。

## 与门禁的映射

| 红线 | 首次落地 | 行为验证门禁 |
|---|---|---|
| 1/2 | E1-T5 options 页 | G-UX-10/11 |
| 3 | E1-T3 工具层 | G-UX-12（注入对抗） |
| 4/5/6 | E2-T6 | G-UX-13 |
| 7 | E1-T1 attach 层 | G-UX-16（里程碑核查） |
| 8 | E0-T2 manifest | G-UX-16 静态核查 |
| 9 | E4-T1 | G-E2E-04 |
| 10 | E3-T7 | G-UX-15（审计导出） |
