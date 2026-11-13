# @eterna/attachments — 附件入口

输入框工具行「附件」按钮：DSH Web 客户端双面插件。

## 功能

在输入框工具行（官方席位 `conversation.input.left`，权限/计划按钮旁）贡献常驻
回形钉按钮。点击打开文件选择，选中文件走两步正规组合：

1. `conversation.createDrafts(sessionId, files, true)`——注册草稿附件
   （图片/文件后台上传即启动，服务面）；
2. `inputActions.addAttachments(ids)`——把草稿 id 挂进当前输入草稿
   （附件栏显示、发送时随消息提交，官方动作面）。

预览、上传进度、失败重试、附件卡渲染全部由上游 `ui-attachment` 附件栏接管；
上传走上游 `POST /api/session/uploadFileBinary`，本包不自建任何上传/存储管线。

## 可见性

- 按钮与上游 InputBar 同源门控：`useAccess('fileUploads/upload')` 为 false 时
  禁用。该动作由 `packages/access/src/mux.ts` 的 `SESSION_UNARY_ACTIONS` 开闸
  （2026-11-12 修复：缺项曾致上游整条附件链路——「+」菜单"文件"命令、粘贴、
  拖拽——对多租户用户全部不可见）。
- admin 停用本插件（设置弹窗「附件入口」开关）= 工具行按钮消失；上游
  「+」菜单"文件"命令、粘贴、拖拽不受影响（其可见性由 mux 动作单独开闸）。

## 结构

- 浏览器半边 `src/client/`：`conversation.input.left` 注入 + 隐藏 file input；
  `@eterna/ui` 令牌（`--et-*` + DSH 桥接双主题）与 `paperclip` 图标。
- Host 半边 `src/index.ts`：idle 装载载具（客户端双面包需宿主 Loader 条目）。
- 装载：`profiles/eterna-web/cordis.patch.yml` 与 `docker/profile/cordis.patch.yml.template`
  的 insert 行 + entrypoint/verify-eterna-web 的 `@eterna/attachments` symlink；
  三方与 `TOGGLEABLE_PLUGINS` 登记由 `packages/access/tests/routes.spec.ts`
  交叉钉住。

## 验证

`pnpm --filter @eterna/attachments run verify`（build:client + oxlint + tsc +
vitest）。浏览器端到端（按钮→上传→附件卡→agent 读取内容）见
`gui-test-screenshots/attachment-e2e-1112/`。
