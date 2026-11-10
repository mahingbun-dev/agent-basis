# CDP 帧协议契约（冻结 v1，proto=1）

> E1-T2 前置任务：「先行冻结 CDP 帧协议契约」（plans/2026-11-10-companion扩展开发计划与测试门禁.md E1-T1/T2）。
> 两端镜像实现：扩展端 `packages/extension-companion/src/protocol.ts`、服务端 `packages/browser-relay/src/protocol.ts`。
> 修改本协议属「协议级重大变更」：按 GATES-CORE 组级触发节奏约定，合入前须全量重跑受影响真机门禁；`proto` 递增。

## 传输

- 扩展端 Service Worker → 服务端 WebSocket：URL 形如 `ws://127.0.0.1:9310/extension`（开发模式，默认仅本机回环）。
- 鉴权：URL 查询参数 `?token=`（开发模式可空；E4-T1 起强制 eterna-access 会话令牌）。令牌不出现在日志。
- 保活：扩展端每 20s 发 `{t:"ping"}`，服务端回 `{t:"pong"}`；另用 `chrome.alarms`（30s）兜底唤醒 SW。
- 帧：单条 JSON 文本消息；所有请求帧带单调递增 `id`，响应帧带同 `id`。

## 扩展端 → 服务端

| 帧 | 字段 | 语义 |
|---|---|---|
| `hello` | `proto, ext, extVersion, chromeVersion?` | 握手；`proto≠1` 服务端拒绝断开 |
| `pong` | — | 保活应答 |
| `result` | `id, ok, result? \| error:{code,message}` | 服务端请求帧的应答 |
| `event` | `tabId, method, params` | chrome.debugger 事件原样转发 |
| `detached` | `tabId, reason?` | chrome.debugger.onDetach（含用户点黄条 Cancel / F12 冲突 / 目标关闭；E2 做分类） |
| `tab.created` | `tab: TabInfo` | tabs.onCreated |
| `tab.updated` | `tabId, title?, url?, active?` | tabs.onUpdated（仅 title/url/active 变化时发） |
| `tab.removed` | `tabId` | tabs.onRemoved |

## 服务端 → 扩展端

| 帧 | 字段 | 语义 |
|---|---|---|
| `ping` | — | 保活 |
| `tabs.list` | `id` | 枚举浏览器 tab |
| `tab.new` | `id, url?, active?` | 新开 tab（agent 默认在自己的新 tab 工作，E3 起加 tab group 圈定） |
| `tab.close` | `id, tabId` | 关闭 tab |
| `tab.activate` | `id, tabId` | 激活 tab |
| `attach` | `id, tabId` | chrome.debugger.attach（不可操作目标由扩展端拒绝并返回 `INELIGIBLE_TARGET`） |
| `detach` | `id, tabId` | 主动解除 |
| `cmd` | `id, tabId, method, params` | CDP 命令逐帧转发（chrome.debugger.sendCommand） |

## 不可操作目标（红线 7）

URL 前缀命中即 `eligible:false`（`tabs.list` 照列但拒绝 attach）：`chrome://`、`chrome-extension://`、`edge://`、`about:`（`about:blank` 除外）、`chromewebstore.google.com`、`chrome.google.com/webstore`。

## 错误码（`error.code`，E1 集合；E2.5 扩策略类）

- `INELIGIBLE_TARGET`：不可操作目标
- `ATTACH_FAILED`：chrome.debugger.attach 失败（含企业策略文案，原文透传 message）
- `CMD_FAILED`：sendCommand 失败（message 透传）
- `TIMEOUT`：命令超时
- `NOT_ATTACHED` / `NO_TAB`：目标不存在或未 attach
- `PROTO_MISMATCH`：握手版本不符
