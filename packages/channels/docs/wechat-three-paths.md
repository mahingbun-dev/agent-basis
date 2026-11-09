# 微信通道三路径实现说明(12 号文档 §7.6)

> 本包(`@eterna/channels`)只提供**适配器接口 + 注册表 + 卡片渲染**;真实网络
> 传输由组合层注入(本包不绑定任何微信 SDK,不真连)。本文给出三条路径的
> 选型依据、接口映射与落地步骤。

## 0. 路径总览与选型矩阵

| # | path ID | 路径 | 登录 | 免加好友 | 合规定位 | 适用 |
|---|---|---|---|---|---|---|
| ① | `wechat/tencent-official` | 腾讯微信团队官方维护的微信插件(OpenClaw 生态 `@tencent-weixin/openclaw-weixin`) | 扫码 QR(个人微信) | 否 | 个人号半官方(插件官方、个人号协议边界灰色) | 个人号首选、内部试点 |
| ② | `wechat/wecom-smart-bot` | 企微智能机器人 API 模式(2026-03 官方) | 企业后台开通(corpid/secret) | 否(企微成员/群) | 官方 | 企业内部协作、组织内审批 |
| ③ | `wechat/wechat-cs` | 微信客服 API | 服务号/企微客服账号授权 | **是** | 官方(生产) | 合规生产首选、对外客户咨询 |

社区 iPad/Gewe 协议:**仅限试点**(封号风险,老号+限频),不入本包注册表
(`createDefaultWeChatRegistry` 只注册以上三条)。

## 1. ① 腾讯官方插件路径(`TencentOfficialTransport`)

- **形态**:与 OpenClaw Gateway 同构的外部网关进程;本侧适配器通过网关的
  本地/内网 API 收发(`sendText` / `sendMedia` / `qrLogin`)。
- **接口映射**(src/wechat.ts):
  - `qrLogin(): { qrUrl, accountExternalId }` —— 生成登录二维码,扫码后
    `accountExternalId` 即渠道侧身份,进 `ChannelBindingStore.bind('wechat', …)`。
  - `sendText(toUser, text)` —— 出站统一走 `renderWeChatText`(文本+审批链接,
    微信无互动卡片,审批按钮退化为一次性令牌链接)。
  - 入站:网关把私信回调 POST 到 `WebhookGateway` 的 `/webhook/wechat`
    (HMAC 验签密钥在网关与本侧共享)。
- **落地步骤**:部署网关插件 → 配置回调指向本侧网关 → `qrLogin` 扫码 →
  绑定 channel_user_id ↔ session_id。
- **风险**:个人号自动化在腾讯协议边界上仍属灰色;限频(建议 ≥30s/条、
  仅私信),封号风险由合规定位(个人实验)显式标注。

## 2. ② 企微智能机器人 API 路径(`WeComSmartBotTransport`)

- **形态**:企业微信后台开通"智能机器人"(2026-03 官方 API 模式),
  收 = 回调 URL,发 = API 调用。
- **接口映射**:
  - `sendText(toUser, text)` —— 机器人 API 发消息(成员/群)。
  - `verifyCallback(rawBody, msgSignature, timestamp, nonce)` —— 企微回调验签
    (sha1(sort(token, timestamp, nonce, encrypt_msg))语义 + AES 解密由
    transport 实现完成;`WebhookGateway` 的 HMAC 层之外的第二道校验)。
  - 入站:企微回调 → `/webhook/wecom`(先过网关 HMAC,再过 transport 的
    `verifyCallback`,两道都过才投递)。
- **落地步骤**:企微管理台创建智能机器人 → 配回调 URL(本侧网关公网地址)
  与 token/encodingAESKey → 出站走机器人 API。
- **审批按钮**:文本链接形态(同①),链接指向 `/approval/:token`。

## 3. ③ 微信客服 API 路径(`WeChatCsTransport`)

- **形态**:微信客服(原企业微信客服)API;**个人微信用户免加好友即可咨询**,
  是对外触达的唯一官方生产级通道。
- **接口映射**:
  - `syncMessages(cursor?)` —— 拉取式同步客服消息(返回 fromUser/text/msgId
    与 nextCursor;fromUser 即 channel_user_id)。
  - `sendText(toUser, text)` —— 客服 API 发消息(48 小时会话窗口内)。
- **落地步骤**:服务号/企微后台开通客服账号 → 拿 access_token(凭据走 DSH
  credentials 引用,不落配置)→ 定时(suggest ≥5min)`syncMessages` 拉新 →
  归一为 `InboundMessage` 投递 `SessionPort.deliverInbound`。
- **审批按钮**:文本链接形态,链接指向 `/approval/:token`。

## 4. 与通道插件的装配关系

```
微信网关/企微回调/客服轮询
        │ (transport 注入)
        ▼
WeChatChannelAdapter(①②③)──sendCard──▶ renderWeChatText(统一携带审批动作载荷)
        │                                     │
        │ 入站                                 ▼
        ▼                              /approval/:token(一次性令牌)
WebhookGateway(HMAC 验签)──▶ BindingStore ──▶ SessionPort.deliverInbound
```

- 出站审批卡片一律经 `buildApprovalCard` 装配 `ApprovalActionPayload`
  (approve/reject 各一枚一次性令牌),微信侧渲染为链接。
- 入站审批回执:用户点链接 → `GET /approval/:token` → `ApprovalTokenService
  .redeem`(单次有效)→ `SessionPort.answerApproval`。
- 微信侧**没有**邮件那种"正文同意"歧义面,但同理禁止从消息文本推断审批
  决定(`InboundMessage` 永远只是消息,不是审批应答)。

## 5. 需运行时联调项(blockers 口径)

- 三条 transport 的真实实现(网关 API 客户端/企微 SDK/客服 API)未在本包
  内实现,接口已钉住;真实联调需要对应平台的凭据与网络环境。
- 企微回调 AES 解密(msg 加密体)在 transport 侧,联调时补齐。
