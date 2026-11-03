# @basis/channels

L1 通道插件:渠道绑定存储、webhook 入站网关、一次性审批令牌、邮箱/微信三路径/
飞书/钉钉适配器接口与出站卡片 schema。承载方式对齐 12 号文档 §7(7.4/7.5/
7.6/7.7/7.8 全部为 **B 插件**,不改内核)。

## 模块一览

| 模块 | 职责 | 关键点 |
|---|---|---|
| `src/binding.ts` | 渠道绑定存储(channel_user_id↔session_id↔渠道类型) | sqlite(node:sqlite,与 dsh storage-sqlite 同驱动);多渠道收敛同一会话;re-bind 即移绑续接;`asDomainKvTable()` 可直挂 storage-domain |
| `src/token.ts` | 一次性审批令牌 | 签发绑定 approval 请求 ID+过期;redeem 单次有效防重放;落库只存 sha256;revokeAll 兜底作废 |
| `src/webhook.ts` | webhook 入站网关 | 极简 node:http server;HMAC-SHA256 验签(timing-safe)→ 投递绑定 session;`/approval/:token` 邮件令牌点击路由 |
| `src/cards.ts` | 出站卡片 | 中立 schema + 飞书(button.value 内嵌载荷)/钉钉(actionURL)渲染;**所有出站审批卡片统一携带审批按钮动作载荷**;传输层注入不真连 |
| `src/email.ts` | 邮箱适配器接口 | IMAP 收(本地最小 ImapMailSource)/SMTP 发(nodemailer 类型钉住,不真连);**禁止解析正文"同意"字样放行**——只认一次性令牌链接 |
| `src/wechat.ts` | 微信三路径适配器接口 | ①腾讯官方插件(QR 个人微信)②企微智能机器人 API ③微信客服 API;注册表唯一 ID;实现说明 `docs/wechat-three-paths.md` |

## 组合(Cordis 纪律)

- 服务形态:`ctx.channels`(`CHANNELS_SERVICE_ID = '@basis/channels'`,注册表 +
  唯一 ID,provide 可交换)。
- 配逆:`WebhookGateway.start()` 返回句柄,`close()` 为其逆闭包;
  `createChannelsService().close()` 收口 sqlite。
- coeffect:本包不触碰 ctx 全局、无旁路副作用;存储与网关均显式生命周期。

## DSH seam(编译期钉住,tests/types.seam-pin.ts)

- SMTP transport:本地 `SmtpTransportLike` ← nodemailer `Transporter`(0.2.x 家族
  外的独立 npm 依赖,仅取类型)。
- 绑定数据面:`asDomainKvTable()` ← `@deepseek-ai/dsh-storage-domain`
  `KvTable<string, ChannelBindingRecord>`(0.2.2-alpha.2)。
- 会话接口 `SessionPort`(deliverInbound/answerApproval)对齐 acp
  `session/prompt` 与 `client.session.requestPermission` 的编程形态
  (../dsh-repo packages/acp/acp/src/index.ts:171,361);真实桥接**需运行时联调**。

## 验收门

`pnpm --filter @basis/channels run verify` = oxlint + `tsc --noEmit` + `vitest run`。
单测覆盖:绑定收敛(多渠道→同一会话)、令牌单次有效与过期、webhook 验签失败
拒绝(401)+ 未知绑定 404 + 令牌重放 410、卡片统一携带审批载荷、邮箱正文
"同意"不产生审批、微信三路径注册表。

## 需运行时联调项

- IMAP/SMTP 真实连接、三条微信 transport、飞书/钉钉真实 API:本包只钉接口
  形态(类型已对齐),组合层注入真实实现后方可联调。
