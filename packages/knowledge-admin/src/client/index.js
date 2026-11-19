/**
 * 知识库管理插件 —— 浏览器半边(纯 JavaScript)。
 *
 * 贡献两点(用户需求:「左侧面板开放入口」「在前端进行知识库的内容管理」):
 *  1. `sidebar.panellist` 列表项:左侧栏「知识库」入口(「基座面板」同席位,order 30);
 *  2. `main` keyed 面板:知识库管理工作台。
 *
 * 纪律:
 *  - 不引用任何 Harness Client 包为模块(react 来自浏览器模块表);
 *  - 工厂零副作用;CSS 以 <style> 注入并在 ctx.effect 里撤销;
 *  - 可见文案全部经 ctx.locale 字典(zh/en);
 *  - 数据只经宿主 `ctx.connection.rpc.call('/api', '<method>@eternaKnowledgeAdmin', { args })` 到达
 *    —— 路径由 access 租户守卫按 cookie 身份解析账号,组件不知道也不判断身份。
 */
window.__ModuleLoader__.load({
  id: '@eterna/knowledge-admin',
  factory(require) {
    var React = require('react');
    var h = React.createElement;

    /** 侧栏入口 id 与 main keyed 槽 key(必须一致:壳按此切换)。 */
    var PANEL_KEY = 'eterna-knowledge-admin';
    /** 语言命名空间。 */
    var NS = 'eternaKnowledgeAdmin';
    /**
     * RPC 端点前缀。**不含 `/api`** —— channel 已经是 `/api`,`ctx.connection.rpc.call`
     * 内部拼成 `${channel}/${endpoint}` 再 slice(1),故 endpoint 须是 `knowledgeAdmin/<m>`,
     * 结果才是 `api/knowledgeAdmin/<m>`(与服务端守卫注册路径一致)。此前写成
     * `/api/knowledgeAdmin/<m>` 会拼出 `api//api/...`,空段被 assertTarget 直接拒绝。
     */
    var GUARD_PREFIX = 'knowledgeAdmin/';

    // ───────────────────────────── 字典 ─────────────────────────────
    var ZH = {
      title: '知识库',
      subtitle: '按登录账号隔离的知识工作台:文档浏览与编辑、提案审批、检索问答、Markdown / 仓库导入、成员权限与审计',
      refresh: '刷新',
      docs: '文档',
      newDoc: '新建文档',
      edit: '编辑',
      save: '保存并提交',
      cancel: '取消',
      deprecate: '废弃',
      deprecateConfirm: '再点一次确认废弃',
      titleField: '标题',
      tagsField: '标签(逗号分隔,可空)',
      originField: '权威来源(URL 或文档名,可空)',
      bodyField: '正文(Markdown)',
      savedPending: '已提交提案,审批通过后发布',
      noDocs: '该账号下暂无文档',
      search: '检索',
      searchPlaceholder: '输入关键词,回车检索',
      searchHint: '结果只来自当前账号的分库;废弃/被取代/未过审的页不会出现',
      ask: '问答',
      askPlaceholder: '提问:答案只基于命中的知识条目,并附引用',
      askAnswer: '答案',
      askCitations: '引用',
      askUnavailable: '问答不可用:',
      proposals: '待审提案',
      noProposals: '无待审提案',
      approve: '批准发布',
      reject: '拒绝',
      discard: '丢弃',
      importTab: '导入',
      importMd: '导入 Markdown',
      importMdHint: '粘贴 Markdown(多页用单独一行 --- 分隔);导入只生成待审提案,不直接发布',
      importRepo: '导入仓库',
      importRepoHint: '仓库 / 目录路径仅限当前账号目录内(填相对路径);任意容器路径会被拒绝;导入只生成待审提案,不直接发布',
      pathField: '仓库 / 目录路径(账号目录内)',
      import: '开始导入',
      imported: '已导入,等待审批',
      members: '成员权限',
      noMembers: '暂无成员记录',
      memberUser: '用户 ID',
      memberLevel: '权限级别',
      removeConfirm: '再点一次确认移除',
      levelRead: '只读',
      levelWrite: '可编辑',
      levelAdmin: '可管理',
      audit: '审计',
      noAudit: '暂无审计记录',
      source: '知识源',
      sourceTest: '检测 DeepWiki 源',
      sourceOk: '可达',
      sourceUnauthorized: '需要授权',
      sourceUnreachable: '不可达',
      sourceNotConfigured: '未配置',
      loading: '加载中…',
      empty: '暂无内容',
      error: '请求失败',
      account: '当前账号',
      count: '条',
    };

    var EN = {
      title: 'Knowledge base',
      subtitle: 'An account-isolated knowledge workbench: browse and edit documents, review proposals, search and ask, import Markdown or repositories, manage members and audit',
      refresh: 'Refresh',
      docs: 'Documents',
      newDoc: 'New document',
      edit: 'Edit',
      save: 'Save and submit',
      cancel: 'Cancel',
      deprecate: 'Deprecate',
      deprecateConfirm: 'Click again to confirm deprecation',
      titleField: 'Title',
      tagsField: 'Tags (comma separated, optional)',
      originField: 'Authoritative source (URL or document name, optional)',
      bodyField: 'Body (Markdown)',
      savedPending: 'Proposal submitted; published after approval',
      noDocs: 'No documents in this account yet',
      search: 'Search',
      searchPlaceholder: 'Type a keyword and press Enter',
      searchHint: 'Results come only from this account; deprecated, superseded, and unreviewed pages never appear',
      ask: 'Ask',
      askPlaceholder: 'Ask a question; the answer cites the matched entries only',
      askAnswer: 'Answer',
      askCitations: 'Citations',
      askUnavailable: 'Ask unavailable: ',
      proposals: 'Pending proposals',
      noProposals: 'No pending proposals',
      approve: 'Approve and publish',
      reject: 'Reject',
      discard: 'Discard',
      importTab: 'Import',
      importMd: 'Import Markdown',
      importMdHint: 'Paste Markdown (separate pages with a --- line); imports only create pending proposals',
      importRepo: 'Import repository',
      importRepoHint: 'Repository path must stay inside the current account directory (relative path); arbitrary container paths are rejected; imports only create pending proposals',
      pathField: 'Repository or directory path (inside account directory)',
      import: 'Start import',
      imported: 'Imported; awaiting review',
      members: 'Members and permissions',
      noMembers: 'No member records yet',
      memberUser: 'User ID',
      memberLevel: 'Level',
      removeConfirm: 'Click again to confirm removal',
      levelRead: 'Read',
      levelWrite: 'Write',
      levelAdmin: 'Manage',
      audit: 'Audit',
      noAudit: 'No audit records yet',
      source: 'Knowledge source',
      sourceTest: 'Test DeepWiki source',
      sourceOk: 'Reachable',
      sourceUnauthorized: 'Authorization required',
      sourceUnreachable: 'Unreachable',
      sourceNotConfigured: 'Not configured',
      loading: 'Loading…',
      empty: 'Nothing here yet',
      error: 'Request failed',
      account: 'Account',
      count: 'items',
    };

    // ───────────────────────────── 样式 ─────────────────────────────
    // v4「温润如玉」(2026-11-19)：只用 --et-* 设计令牌与共享 et-* 基础件 class。
    // 此前自建 992 行客户端里写了 23 处字面色值(含 #2563eb 电光蓝)、9 个上游根本
    // 不存在的 --dsw-alias-* 名字(fg-primary/accent/bg-elevated…),界面实际跑在
    // 兜底色、深浅主题都不跟随——lint 白名单漏检导致带病入库的典型。
    //
    // 本插件是纯 JS 工件，无法 import @eterna/ui 的 TS 组件；故：
    // - 令牌由 access 侧的 injectDesignTokens({bridge:true}) 提供（同页面共用 body 层）；
    // - 这里只声明「本插件私有布局 + 复用共享 class 的少量补充」，不重复定义基础件。
    var CSS = [
      // 根容器：画布与阅读宽度
      "[data-kb='root']{box-sizing:border-box;width:100%;height:100%;overflow-y:auto;overflow-x:hidden;",
      "padding:var(--et-space-8) var(--et-space-8) var(--et-space-24);display:flex;flex-direction:column;gap:var(--et-space-5);",
      "color:var(--et-fg);background:var(--et-bg);font-family:var(--et-font-body);font-size:var(--et-text-body);",
      "font-weight:var(--et-weight-body);line-height:var(--et-leading-body);}",
      "[data-kb='root'] *{box-sizing:border-box;min-width:0;}",

      // 页头
      "[data-kb='head']{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--et-space-3);",
      "padding-bottom:var(--et-space-4);border-bottom:1px solid var(--et-border-soft);}",
      // 标题用宋体（v4 唯一的排版主张；宋体只用于页面/分区标题）
      "[data-kb='h1']{margin:0;font-family:var(--et-font-display);font-size:var(--et-text-h2);",
      "font-weight:var(--et-weight-display);line-height:var(--et-leading-snug);letter-spacing:var(--et-tracking-display);}",
      "[data-kb='sub']{margin:var(--et-space-2) 0 0;font-size:var(--et-text-caption);color:var(--et-muted);}",

      // 按钮：复用共享 .et-btn，仅补两种语气（不再自建按钮外观）
      "[data-kb='btn']{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:var(--et-space-2);",
      "font-family:var(--et-font-body);font-size:var(--et-text-caption);font-weight:var(--et-weight-emphasis);line-height:1;",
      "padding:0 var(--et-space-4);height:40px;border-radius:var(--et-radius-md);",
      "border:1px solid var(--et-border);background:var(--et-surface);color:var(--et-fg);cursor:pointer;white-space:nowrap;flex:none;",
      "transition:background-color var(--et-motion-fast) var(--et-ease),border-color var(--et-motion-fast) var(--et-ease),transform var(--et-motion-fast) var(--et-ease);}",
      "[data-kb='btn']:hover:not(:disabled){background:var(--et-surface-2);}",
      "[data-kb='btn']:active:not(:disabled){transform:scale(.985);}",
      "[data-kb='btn']:focus-visible{outline:none;box-shadow:var(--et-focus-ring);}",
      "[data-kb='btn']:disabled{opacity:.5;cursor:default;transform:none;}",
      "[data-kb='btn'][data-tone='primary']{background:var(--et-accent-fill);border-color:transparent;color:var(--et-accent-on);",
      "box-shadow:var(--et-shadow-r1);}",
      "[data-kb='btn'][data-tone='primary']:hover:not(:disabled){background:var(--et-accent-fill-hover);}",
      "[data-kb='btn'][data-tone='danger']{background:transparent;",
      "border-color:color-mix(in oklab,var(--et-danger),transparent 70%);color:var(--et-danger);}",
      "[data-kb='btn'][data-tone='danger']:hover:not(:disabled){background:var(--et-danger-soft);}",

      // 标签页：胶囊分段（v4 禁止下划线式 tab 与直角段）
      "[data-kb='tabs']{display:flex;gap:var(--et-space-2);flex-wrap:wrap;align-items:center;}",
      "[data-kb='tab']{appearance:none;font-family:var(--et-font-body);font-size:var(--et-text-caption);",
      "padding:0 var(--et-space-3);height:32px;border:1px solid transparent;border-radius:var(--et-radius-pill);",
      "background:transparent;color:var(--et-muted);cursor:pointer;white-space:nowrap;",
      "transition:background-color var(--et-motion-fast) var(--et-ease),color var(--et-motion-fast) var(--et-ease);}",
      "[data-kb='tab']:hover{background:var(--et-surface-2);color:var(--et-fg);}",
      "[data-kb='tab']:focus-visible{outline:none;box-shadow:var(--et-focus-ring);}",
      "[data-kb='tab'][data-active='true']{background:var(--et-accent-fill);color:var(--et-accent-on);font-weight:var(--et-weight-emphasis);}",

      // 卡片：一级 surface + border-soft + r1 + lg
      "[data-kb='card']{border:1px solid var(--et-border-soft);border-radius:var(--et-radius-lg);",
      "padding:var(--et-space-5);display:flex;flex-direction:column;gap:var(--et-space-3);",
      "background:var(--et-surface);box-shadow:var(--et-shadow-r1);color:var(--et-fg);}",

      // 行卡：高 ≥56，仅横向分隔线（行不得有圆角）
      "[data-kb='row']{display:flex;align-items:center;justify-content:space-between;gap:var(--et-space-3);",
      "min-height:56px;padding:var(--et-space-3) 0;border-bottom:1px solid var(--et-border-soft);}",
      "[data-kb='row']:last-child{border-bottom:0;}",

      // 工具条：按钮 + 元数据的横向一行。
      // 缺这条规则时 Toolbar 退化成块级堆叠——1440 下按钮与计数挤成一串、
      // 390 下每个按钮各占一整行（实测 2026-11-19）。wrap 允许窄屏折行。
      "[data-kb='bar']{display:flex;align-items:center;gap:var(--et-space-3);flex-wrap:wrap;min-width:0;}",
      "[data-kb='bar']>[data-kb='meta']{min-width:0;}",

      "[data-kb='meta']{font-size:var(--et-text-meta);color:var(--et-meta);font-variant-numeric:tabular-nums;}",
      "[data-kb='empty']{padding:var(--et-space-8);text-align:center;color:var(--et-muted);font-size:var(--et-text-caption);}",

      // 错误条：语义色只染边框与文字，不做整片底色
      "[data-kb='error']{padding:var(--et-space-3) var(--et-space-4);border-radius:var(--et-radius-md);",
      "border:1px solid color-mix(in oklab,var(--et-danger),transparent 62%);background:var(--et-danger-soft);",
      "color:var(--et-danger);font-size:var(--et-text-caption);white-space:pre-wrap;}",

      // 输入：凹槽面 + md 圆角（与共享 .et-input 同规格：40px 高）
      "[data-kb='input'],[data-kb='textarea'],[data-kb='select']{width:100%;box-sizing:border-box;",
      "font-family:var(--et-font-body);font-size:var(--et-text-body);color:var(--et-fg);",
      "padding:0 var(--et-space-3);height:40px;border-radius:var(--et-radius-md);",
      "border:1px solid var(--et-border);background:var(--et-surface-3);",
      "transition:border-color var(--et-motion-fast) var(--et-ease),box-shadow var(--et-motion-fast) var(--et-ease);}",
      "[data-kb='input']:focus,[data-kb='textarea']:focus,[data-kb='select']:focus{",
      "outline:none;border-color:var(--et-accent);box-shadow:var(--et-focus-ring);}",
      "[data-kb='textarea']{min-height:220px;height:auto;padding:var(--et-space-3);",
      "font-family:var(--et-font-mono);line-height:var(--et-leading-body);resize:vertical;}",
      "[data-kb='label']{display:flex;flex-direction:column;gap:6px;font-size:var(--et-text-caption);color:var(--et-fg-2);}",

      // 文档正文预览：凹槽 + 等宽（不是卡片，不套阴影）
      "[data-kb='body']{white-space:pre-wrap;font-family:var(--et-font-mono);font-size:var(--et-text-caption);",
      "line-height:var(--et-leading-body);background:var(--et-surface-2);padding:var(--et-space-4);",
      "border-radius:var(--et-radius-md);max-height:400px;overflow:auto;}",

      // 徽标：胶囊 + 必须配文字（调用方保证）
      "[data-kb='badge']{display:inline-flex;align-items:center;height:24px;font-size:var(--et-text-micro);",
      "padding:0 var(--et-space-2);border-radius:var(--et-radius-pill);",
      "border:1px solid var(--et-border);color:var(--et-muted);white-space:nowrap;}",

      // 断点：v4 只允许 1100/760/640。<760 收 gutter 16，不再有 900px
      "@media (max-width:760px){[data-kb='root']{padding:var(--et-space-4) var(--et-space-4) var(--et-space-12);gap:var(--et-space-4);}",
      "[data-kb='h1']{font-size:var(--et-text-h3);}",
      // 页头竖排后按钮不得被 stretch 拉成整宽：保持自身宽度并靠左。
      "[data-kb='head']{flex-direction:column;align-items:flex-start;}",
      "[data-kb='card']{padding:var(--et-space-4);}}",
      "@media (max-width:640px){[data-kb='tabs']{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;}",
      "[data-kb='tabs']::-webkit-scrollbar{display:none;}",
      // 640 以下按钮不再一刀切整宽（那会把工具条撑成四行按钮堆）；改为：
      // 工具条内多个按钮等分宽度、元数据独占一行。只有一个按钮时不拉伸——
      // 单按钮整宽在窄屏上显得笨重（实测 2026-11-19 390 截图）。
      "[data-kb='bar']{gap:var(--et-space-2);}",
      "[data-kb='bar']>[data-kb='btn']:not(:only-of-type){flex:1 1 0;min-width:0;padding:0 var(--et-space-3);}",
      "[data-kb='bar']>[data-kb='meta']{flex:1 1 100%;}}",

      "@media (prefers-reduced-motion:reduce){[data-kb='btn'],[data-kb='tab']{transition-duration:120ms;}",
      "[data-kb='btn']:active:not(:disabled){transform:none;}}",
    ].join('\n');

    function injectStyles(doc) {
      var marker = 'data-eterna-kb-styles';
      var existing = doc.querySelector('style[' + marker + ']');
      if (existing !== null) return function () {};
      var style = doc.createElement('style');
      style.textContent = CSS;
      style.setAttribute(marker, 'true');
      doc.head.append(style);
      return function () { style.remove(); };
    }

    // ───────────────────────────── 宿主调用 ─────────────────────────────
    /** 统一封套:`{ ok: true, value } | { ok: false, code, message }`。 */
    /**
     * 双层封套塌成一层(RpcOutcome<KnowledgeResult<T>> → { ok, value }):
     *   外层 = 连接层 outcome({ok,value}|{ok:false,error:{code,message,details}});
     *   内层 = access 守卫的 okFrame/failureFrame 封出的 KnowledgeResult
     *          ({ok:true,value}|{ok:false,code,message})。
     * 只剥一层会把整个 KnowledgeResult 当成业务载荷,页面永远读不到 items/total。
     */
    function unwrap(result) {
      if (result === null || typeof result !== 'object') {
        return { ok: false, code: 'internal', message: '响应不是对象' };
      }
      // ① 连接层失败(含守卫 deniedFrame 的 tenant/denied)
      if (result.ok !== true) {
        var error = result.error;
        return {
          ok: false,
          code: (error && error.code) || 'internal',
          message: (error && error.message) || (error && error.code) || '连接层失败(无错误详情)',
        };
      }
      // ② 守卫封帧的 KnowledgeResult
      var boxed = result.value;
      if (boxed !== null && typeof boxed === 'object' && boxed.ok === true) {
        return { ok: true, value: boxed.value };
      }
      if (boxed !== null && typeof boxed === 'object' && boxed.ok === false) {
        return { ok: false, code: boxed.code || 'internal', message: boxed.message || 'unknown' };
      }
      // ③ 形态非法(例如守卫未挂载时返回的裸文本)
      return { ok: false, code: 'state', message: '响应封帧非法(缺少 KnowledgeResult 外层)' };
    }

    /**
     * 一次宿主调用。路径 = `/api/<method>@eternaKnowledgeAdmin`(守卫注册形态);
     * 载荷恒 `{ args }`(网关要求恰好一个 plain-object args)。
     */
    function call(rpc, method, args) {
      return Promise.resolve(rpc.call('/api', GUARD_PREFIX + method, { args: args || {} }))
        .then(unwrap, function (error) {
          return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) };
        });
    }

    // ───────────────────────────── 原子组件 ─────────────────────────────
    function Badge(props) { return h('span', { 'data-kb': 'badge' }, props.children); }
    function Empty(props) { return h('div', { 'data-kb': 'empty' }, props.children); }
    function ErrorBox(props) { return h('div', { 'data-kb': 'error', role: 'alert' }, props.message); }
    function Toolbar(props) { return h('div', { 'data-kb': 'bar' }, props.children); }
    function Card(props) { return h('div', { 'data-kb': 'card' }, props.children); }

    function Button(props) {
      return h('button', {
        type: 'button',
        'data-kb': 'btn',
        'data-tone': props.tone || 'ghost',
        disabled: props.disabled === true || props.busy === true,
        onClick: props.onClick,
        title: props.title,
      }, props.children);
    }

    function Input(props) {
      return h('label', { 'data-kb': 'label' }, props.label,
        h('input', {
          'data-kb': 'input',
          type: 'text',
          value: props.value,
          placeholder: props.placeholder || '',
          onChange: function (event) { props.onChange(event.target.value); },
        }));
    }

    function TextArea(props) {
      return h('label', { 'data-kb': 'label' }, props.label,
        h('textarea', {
          'data-kb': 'textarea',
          value: props.value,
          placeholder: props.placeholder || '',
          onChange: function (event) { props.onChange(event.target.value); },
        }));
    }

    function Row(props) {
      return h('div', { 'data-kb': 'row' }, props.left, props.right);
    }

    // ───────────────────────────── 主面板 ─────────────────────────────
    function KnowledgePanel(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var tab = state.tab;

      function TabButton(id, text) {
        return h('button', {
          type: 'button',
          'data-kb': 'tab',
          'data-active': tab === id ? 'true' : 'false',
          onClick: function () { ui.setTab(id); },
        }, text);
      }

      var pane = null;
      if (state.auth === 'anonymous') {
        pane = h(ErrorBox, { message: '需要登录后使用知识库:宿主守卫未解析出登录身份' });
      } else if (state.auth === 'pending') {
        pane = h(Empty, null, t('loading'));
      } else if (tab === 'edit') {
        pane = h(EditPane, props);
      } else if (tab === 'ask') {
        pane = h(AskPane, props);
      } else if (tab === 'proposals') {
        pane = h(ProposalsPane, props);
      } else if (tab === 'import') {
        pane = h(ImportPane, props);
      } else if (tab === 'members') {
        pane = h(MembersPane, props);
      } else if (tab === 'audit') {
        pane = h(AuditPane, props);
      } else {
        pane = h(DocsPane, props);
      }

      return h('div', { 'data-kb': 'root' },
        h('div', { 'data-kb': 'head' },
          h('div', null,
            h('h1', { 'data-kb': 'h1' }, t('title')),
            h('p', { 'data-kb': 'sub' }, t('subtitle'))),
          h(Toolbar, null,
            h(Button, { onClick: function () { ui.refresh(); }, busy: state.loading }, t('refresh')))),
        h('div', { 'data-kb': 'tabs' },
          TabButton('docs', t('docs')),
          TabButton('edit', t('newDoc')),
          TabButton('ask', t('ask')),
          TabButton('proposals', t('proposals')),
          TabButton('import', t('importTab')),
          TabButton('members', t('members')),
          TabButton('audit', t('audit'))),
        pane,
        state.notice !== null ? h('div', { 'data-kb': 'meta' }, state.notice) : null,
        state.error !== null ? h(ErrorBox, { message: t('error') + ': ' + state.error }) : null,
        h('p', { 'data-kb': 'meta' }, t('account') + ': ' + (state.account || '—') + (state.global ? ' (global)' : '')));
    }

    // ── 文档浏览 / 检索 ──
    function DocsPane(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var ui = props.ui;
      var results = state.results;

      var rows;
      if (state.loading && results === null) {
        rows = h(Empty, null, t('loading'));
      } else if (results !== null) {
        rows = results.length === 0
          ? h(Empty, null, t('empty'))
          : results.map(function (hit, index) {
            return h(Row, {
              key: 'r' + index,
              left: h('div', null,
                h('div', null, hit.title || (hit.ref && hit.ref.doc_id) || ''),
                h('div', { 'data-kb': 'meta' }, (hit.snippet || '') + ' · ' + (String(Math.round((hit.score || 0) * 100)) + '%')),
                h('div', { 'data-kb': 'meta' }, hit.citation || '')),
              right: h(Badge, null, (hit.provenance && hit.provenance.status) || 'active'),
            });
          });
      } else {
        var docs = state.docs || [];
        rows = docs.length === 0 ? h(Empty, null, t('noDocs')) : docs.map(function (doc, index) {
          return h(Row, {
            key: 'd' + index,
            left: h('div', null,
              h('div', null, doc.title || doc.doc_id),
              h('div', { 'data-kb': 'meta' }, doc.doc_id + (doc.tags.length > 0 ? ' · ' + doc.tags.join(', ') : '')),
              doc.provenance && doc.provenance.origin
                ? h('div', { 'data-kb': 'meta' }, doc.provenance.origin)
                : null),
            right: h('div', { 'data-kb': 'bar' },
              h(Badge, null, (doc.provenance && doc.provenance.status) || 'active'),
              h(Button, { busy: state.busy, onClick: function () { ui.openDoc(doc.doc_id); } }, t('edit')),
              h(Button, {
                tone: 'danger',
                busy: state.busy,
                onClick: function () {
                  if (state.confirmDoc !== doc.doc_id) { ui.setConfirmDoc(doc.doc_id); return; }
                  ui.setConfirmDoc(null);
                  ui.deprecate(doc.doc_id);
                },
              }, state.confirmDoc === doc.doc_id ? t('deprecateConfirm') : t('deprecate'))),
          });
        });
      }

      return h(Card, null,
        h('div', { 'data-kb': 'bar' },
          h(Button, { onClick: function () { ui.newDoc(); } }, t('newDoc')),
          h('span', { 'data-kb': 'meta' }, String(state.total) + ' ' + t('count') + ' · ' + t('proposals') + ' ' + String(state.pendingCount || 0))),
        Input({
          label: t('search'),
          value: state.query,
          placeholder: t('searchPlaceholder'),
          onChange: function (value) { ui.setQuery(value); },
        }),
        h('div', { 'data-kb': 'bar' },
          h(Button, { busy: state.busy, onClick: function () { ui.search(); } }, t('search')),
          h(Button, { onClick: function () { ui.clearSearch(); } }, t('cancel')),
          h('span', { 'data-kb': 'meta' }, t('searchHint'))),
        rows);
    }

    // ── 新建 / 编辑 ──
    function EditPane(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var ui = props.ui;
      var draft = state.draft;

      return h(Card, null,
        Input({ label: t('titleField'), value: draft.title, onChange: function (v) { ui.setDraft({ title: v }); } }),
        Input({ label: t('tagsField'), value: draft.tags, onChange: function (v) { ui.setDraft({ tags: v }); } }),
        Input({ label: t('originField'), value: draft.origin, onChange: function (v) { ui.setDraft({ origin: v }); } }),
        TextArea({
          label: t('bodyField'),
          value: draft.body,
          onChange: function (v) { ui.setDraft({ body: v }); },
        }),
        h('div', { 'data-kb': 'bar' },
          h(Button, { tone: 'primary', busy: state.busy, onClick: function () { ui.saveDraft(); } }, t('save')),
          h(Button, { onClick: function () { ui.resetDraft(); } }, t('cancel')),
          state.notice !== null ? h('span', { 'data-kb': 'meta' }, state.notice) : null));
    }

    // ── 检索问答 ──
    function AskPane(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var ui = props.ui;
      var ask = state.ask;

      return h(Card, null,
        Input({
          label: t('ask'),
          value: ask.question,
          placeholder: t('askPlaceholder'),
          onChange: function (value) { ui.setAsk({ question: value }); },
        }),
        h('div', { 'data-kb': 'bar' },
          h(Button, { tone: 'primary', busy: state.busy || ask.running, onClick: function () { state.askQuestion(); } }, t('ask'))),
        ask.reason !== null ? h(ErrorBox, { message: t('askUnavailable') + ask.reason }) : null,
        ask.answer !== null
          ? h('label', { 'data-kb': 'label' }, t('askAnswer'), h('div', { 'data-kb': 'body' }, ask.answer))
          : null,
        ask.citations.length > 0
          ? h('label', { 'data-kb': 'label' }, t('askCitations'),
            ask.citations.map(function (hit, index) {
              return h(Row, {
                key: 'c' + index,
                left: h('div', null,
                  h('div', null, hit.title),
                  h('div', { 'data-kb': 'meta' }, hit.citation || '')),
                right: h(Badge, null, hit.source || 'wiki-local'),
              });
            }))
          : null);
    }

    // ── 提案审批 ──
    function ProposalsPane(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var ui = props.ui;
      var proposals = state.proposals || [];

      if (proposals.length === 0) return h(Empty, null, t('noProposals'));

      return proposals.map(function (proposal, index) {
        return h(Card, {
          key: 'p' + index,
        },
        h(Row, {
          left: h('div', null,
            h('div', null, proposal.title || proposal.id),
            h('div', { 'data-kb': 'meta' }, proposal.id + ' · ' + proposal.created_at + ' · ' + proposal.account),
            h('div', { 'data-kb': 'meta' }, (proposal.body || '').slice(0, 240))),
          right: h('div', { 'data-kb': 'bar' },
            h(Badge, null, proposal.state),
            h(Button, { tone: 'primary', busy: state.busy, onClick: function () { ui.review(proposal.id, 'approve'); } }, t('approve')),
            h(Button, { tone: 'danger', busy: state.busy, onClick: function () { ui.review(proposal.id, 'reject'); } }, t('reject')),
            h(Button, { busy: state.busy, onClick: function () { ui.discard(proposal.id); } }, t('discard'))),
        }));
      });
    }

    // ── 导入 ──
    function ImportPane(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var ui = props.ui;

      return h('div', { 'data-kb': 'root' },
        h(Card, null,
          h('div', { 'data-kb': 'meta' }, t('importMdHint')),
          TextArea({
            label: t('importMd'),
            value: state.importMd,
            onChange: function (value) { ui.setImportMd(value); },
          }),
          h('div', { 'data-kb': 'bar' },
            h(Button, { tone: 'primary', busy: state.busy, onClick: function () { ui.importMarkdown(); } }, t('import')),
            state.notice !== null ? h('span', { 'data-kb': 'meta' }, state.notice) : null)),
        h(Card, null,
          h('div', { 'data-kb': 'meta' }, t('importRepoHint')),
          Input({
            label: t('pathField'),
            value: state.repoPath,
            placeholder: 'projects/my-repo',
            onChange: function (value) { ui.setRepoPath(value); },
          }),
          h('div', { 'data-kb': 'bar' },
            h(Button, { tone: 'primary', busy: state.busy, onClick: function () { ui.importRepo(); } }, t('import')))));
    }

    // ── 成员权限 ──
    function MembersPane(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var ui = props.ui;
      var members = state.members || [];
      var levels = [['viewer', t('levelRead')], ['editor', t('levelWrite')], ['owner', t('levelAdmin')]];

      return h(Card, null,
        members.length === 0 ? h(Empty, null, t('noMembers')) : members.map(function (member, index) {
          return h(Row, {
            key: 'm' + index,
            left: h('div', null,
              h('div', null, t('memberUser') + ' ' + String(member.member_user_id)),
              h('div', { 'data-kb': 'meta' }, member.account + ' · ' + member.updated_at)),
            right: h('div', { 'data-kb': 'bar' },
              h('select', {
                'data-kb': 'select',
                value: member.level,
                onChange: function (event) { ui.saveMember(member.member_user_id, event.target.value); },
              }, levels.map(function (pair) { return h('option', { key: pair[0], value: pair[0] }, pair[1]); })),
              // 破坏性操作两击确认(交互纪律;与文档废弃同款模式),禁用原生 confirm()
              h(Button, {
                tone: 'danger',
                busy: state.busy,
                onClick: function () {
                  if (state.confirmRemove !== member.member_user_id) { ui.setConfirmRemove(member.member_user_id); return; }
                  ui.setConfirmRemove(null);
                  ui.saveMember(member.member_user_id, 'remove');
                },
              }, state.confirmRemove === member.member_user_id ? t('removeConfirm') : t('discard'))),
          });
        }),
        h(Toolbar, null,
          Input({ label: t('memberUser'), value: state.memberDraft.userId, onChange: function (v) { ui.setMemberDraft({ userId: v }); } }),
          h('select', {
            'data-kb': 'select',
            value: state.memberDraft.level,
            onChange: function (event) { ui.setMemberDraft({ level: event.target.value }); },
            style: { maxWidth: '150px' },
          }, levels.map(function (pair) { return h('option', { key: pair[0], value: pair[0] }, pair[1]); })),
          h(Button, { tone: 'primary', busy: state.busy, onClick: function () { ui.addMember(); } }, t('save'))));
    }

    // ── 审计与知识源 ──
    function AuditPane(props) {
      var t = props.t;
      var ui = props.ui;
      var state = props.state;
      var ui = props.ui;
      var audit = state.audit || [];
      var sources = state.sources || [];

      return h('div', { 'data-kb': 'root' },
        h(Card, null,
          h(Toolbar, null,
            h(Button, { busy: state.busy, onClick: function () { ui.testSource(); } }, t('sourceTest')),
            sources.map(function (status, index) {
              return h(Badge, { key: 's' + index },
                status.id + ': ' + (status.status === 'ok' ? t('sourceOk') : status.status === 'unauthorized' ? t('sourceUnauthorized') : status.status === 'not-configured' ? t('sourceNotConfigured') : t('sourceUnreachable')));
            }))),
        h(Card, null,
          audit.length === 0 ? h(Empty, null, t('noAudit')) : audit.map(function (entry, index) {
            return h(Row, {
              key: 'a' + index,
              left: h('div', null,
                h('div', null, entry.action),
                h('div', { 'data-kb': 'meta' }, entry.ts + ' · ' + entry.outcome + (entry.detail ? ' · ' + entry.detail : ''))),
              right: h(Badge, null, entry.account || ''),
            });
          })));
    }

    // ───────────────────────────── 状态源 ─────────────────────────────
    /**
     * 裸 observable 源:渲染器按 inject 面 `hooks.<name>` 绑成 `props.use<Name>`
     * 选择器钩子(packages/panel 同款约定)。这里只暴露一个整体观察值,
     * 组件按需在 selector 里取切片;写入即通知。
     */
    function createSource(initial) {
      var value = initial;
      var listeners = new Set();
      return {
        getSnapshot: function () { return value; },
        subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
        publish: function (next) {
          value = typeof next === 'function' ? next(value) : next;
          listeners.forEach(function (listener) { listener(); });
        },
      };
    }

    function initialState() {
      return {
        auth: 'pending',
        account: '',
        global: false,
        admin: false,
        loading: true,
        error: null,
        tab: 'docs',
        query: '',
        docs: [],
        total: 0,
        results: null,
        draft: { title: '', tags: '', origin: '', body: '', docId: '', path: '' },
        notice: null,
        busy: false,
        confirmDoc: null,
        ask: { question: '', answer: null, citations: [], reason: null, running: false },
        proposals: [],
        importMd: '',
        repoPath: '',
        members: [],
        memberDraft: { userId: '', level: 'editor' },
        confirmRemove: null,
        audit: [],
        sources: [],
        docTotal: 0,
        pendingCount: 0,
        degraded: [],
      };
    }

    /** 拆分多页 Markdown:单独一行 `---` 为分隔符(每页首行若为 `# 标题` 则取作标题)。 */
    function splitMarkdown(text) {
      var blocks = text.split(/\n\s*---\s*\n/);
      var documents = [];
      blocks.forEach(function (block) {
        var body = block.trim();
        if (body === '') return;
        var lines = body.split('\n');
        var first = lines[0].trim();
        var title = '';
        if (first.indexOf('# ') === 0) {
          title = first.slice(2).trim();
          lines = lines.slice(1);
          body = lines.join('\n').trim();
        }
        documents.push({ title: title || (body.split('\n')[0] || '').slice(0, 60) || 'untitled', body: body });
      });
      return documents;
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply: function (ctx) {
        var disposers = [];
        var disposeStyles = injectStyles(document);
        if (disposeStyles) disposers.push(disposeStyles);
        var disposeLocale = ctx.locale.register(NS, { zh: ZH, en: EN });
        if (typeof disposeLocale === 'function') disposers.push(disposeLocale);
        var t = ctx.locale.bind(NS);

        var source = createSource(initialState());
        var patch = function (fn) { source.publish(function (state) { return fn(state); }); };
        var set = function (partial) { patch(function (state) { return Object.assign({}, state, partial); }); };
        var setDraft = function (partial) {
          patch(function (state) { return Object.assign({}, state, { draft: Object.assign({}, state.draft, partial) }); });
        };
        var setAsk = function (partial) {
          patch(function (state) { return Object.assign({}, state, { ask: Object.assign({}, state.ask, partial) }); });
        };
        var setMemberDraft = function (partial) {
          patch(function (state) { return Object.assign({}, state, { memberDraft: Object.assign({}, state.memberDraft, partial) }); });
        };
        var current = function () { return source.getSnapshot(); };
        var knownUser = 0;

        /** 失败即落 error 并收尾 busy;返回是否成功。 */
        var settle = function (result) {
          if (result.ok === true) return true;
          set({ error: result.code + ': ' + result.message, busy: false, loading: false });
          return false;
        };

        var loadAccounts = function () {
          return call(ctx.connection.rpc, 'listAccounts', {}).then(function (result) {
            if (!settle(result)) { set({ auth: 'anonymous', loading: false }); return; }
            var accounts = (result.value && result.value.accounts) || [];
            // 当前账号 = 服务端判定的登录者本人(`self` 标记,守卫按 cookie 铸出)。
            // 绝不从"可管理账号列表"里猜:admin 的列表含全部账号,首个非 global 是
            // 字母序任意账号(生产实证:登录 Mr.Ma 显示成 cherry)。
            var own = accounts.filter(function (info) { return info.self === true; })[0] || accounts[0];
            set({ auth: 'authenticated', account: own ? own.account : '', global: own ? own.global === true : false });
            loadOverview();
          });
        };

        var loadOverview = function () {
          return call(ctx.connection.rpc, 'overview', {}).then(function (result) {
            if (!settle(result)) return;
            var value = result.value || {};
            set({
              loading: false,
              busy: false,
              sources: value.sources || [],
              docTotal: value.doc_count || 0,
              pendingCount: value.proposal_pending || 0,
              degraded: value.degraded || [],
            });
            loadDocs();
          });
        };

        var loadDocs = function () {
          return call(ctx.connection.rpc, 'listDocs', { limit: 50 }).then(function (result) {
            if (!settle(result)) return;
            var value = result.value || {};
            set({ docs: value.items || [], total: value.total || 0, loading: false, busy: false });
          });
        };

        var refresh = function () {
          set({ loading: true, error: null, results: null });
          if (current().auth === 'pending') loadAccounts();
          else loadOverview();
        };

        var listProposals = function () {
          return call(ctx.connection.rpc, 'listProposals', { limit: 50 }).then(function (result) {
            if (!settle(result)) return;
            set({ proposals: (result.value && result.value.items) || [], busy: false });
          });
        };
        var listMembers = function () {
          return call(ctx.connection.rpc, 'listMembers', {}).then(function (result) {
            if (!settle(result)) return;
            set({ members: (result.value && result.value.members) || [], busy: false });
          });
        };
        var listAudit = function () {
          return call(ctx.connection.rpc, 'listAudit', { limit: 100 }).then(function (result) {
            if (!settle(result)) return;
            set({ audit: (result.value && result.value.items) || [], busy: false });
          });
        };

        var ui = {
          refresh: refresh,
          setTab: function (tab) {
            set({ tab: tab, confirmRemove: null });
            if (tab === 'proposals') listProposals();
            if (tab === 'members') listMembers();
            if (tab === 'audit') listAudit();
            if (tab === 'docs') loadDocs();
          },
          setQuery: function (q) { set({ query: q }); },
          search: function () {
            var q = current().query.trim();
            if (q === '') return;
            set({ busy: true, error: null });
            call(ctx.connection.rpc, 'search', { query: q, top_k: 20 }).then(function (result) {
              if (!settle(result)) return;
              var value = result.value || {};
              var degraded = (value.degraded || []).map(function (entry) { return entry.source + ': ' + entry.reason; }).join('; ');
              set({ results: value.hits || [], busy: false, notice: degraded === '' ? null : degraded });
            });
          },
          clearSearch: function () { set({ query: '', results: null, notice: null }); },
          newDoc: function () {
            set({
              tab: 'edit',
              selected: null,
              notice: null,
              draft: { title: '', tags: '', origin: '', body: '', docId: '', path: '' },
            });
          },
          openDoc: function (docId) {
            set({ busy: true, error: null });
            call(ctx.connection.rpc, 'readDoc', { doc_id: docId }).then(function (result) {
              if (!settle(result)) return;
              var doc = result.value || {};
              set({
                tab: 'edit',
                selected: docId,
                busy: false,
                notice: null,
                draft: {
                  title: doc.title || '',
                  tags: (doc.tags || []).join(', '),
                  origin: (doc.provenance && doc.provenance.origin) || '',
                  body: doc.body || '',
                  docId: docId,
                  path: (doc.ref && doc.ref.source_uri) || '',
                },
              });
            });
          },
          setDraft: setDraft,
          resetDraft: function () {
            set({ draft: { title: '', tags: '', origin: '', body: '', docId: '', path: '' }, selected: null, notice: null });
          },
          saveDraft: function () {
            var draft = current().draft;
            if (draft.title.trim() === '' || draft.body.trim() === '') {
              set({ error: t('titleField') + ' / ' + t('bodyField') });
              return;
            }
            set({ busy: true, error: null, notice: null });
            call(ctx.connection.rpc, 'saveDoc', {
              doc_id: draft.docId || undefined,
              title: draft.title,
              body: draft.body,
              tags: draft.tags.split(',').map(function (tag) { return tag.trim(); }).filter(function (tag) { return tag.length > 0; }),
              origin: draft.origin || undefined,
              path: draft.path || undefined,
              publish: true,
            }).then(function (result) {
              if (!settle(result)) return;
              var value = result.value || {};
              set({ busy: false, notice: t('savedPending') + ' (' + value.proposal_id + ' · ' + value.state + ')' });
              loadDocs();
            });
          },
          deprecate: function (docId) {
            set({ busy: true, error: null });
            call(ctx.connection.rpc, 'deprecateDoc', { doc_id: docId, reason: 'management panel: deprecated by user' }).then(function (result) {
              if (!settle(result)) return;
              var value = result.value || {};
              set({ busy: false, notice: value.undo_hint || null });
              loadDocs();
            });
          },
          setConfirmDoc: function (docId) { set({ confirmDoc: docId }); },
          askQuestion: function () {
            var question = current().ask.question.trim();
            if (question === '') return;
            setAsk({ running: true, answer: null, citations: [], reason: null });
            call(ctx.connection.rpc, 'ask', { question: question, top_k: 6 }).then(function (result) {
              var value = result.value || {};
              if (result.ok !== true) {
                setAsk({ running: false, reason: value.reason || (result.code + ': ' + result.message) });
                set({ busy: false });
                return;
              }
              setAsk({ running: false, answer: value.answer || null, citations: value.citations || [] });
            });
          },
          setAsk: setAsk,
          review: function (proposalId, decision) {
            set({ busy: true, error: null });
            call(ctx.connection.rpc, 'reviewProposal', {
              proposal_id: proposalId,
              decision: decision,
              reason: decision === 'reject' ? 'management panel: rejected by user' : undefined,
            }).then(function (result) {
              if (!settle(result)) return;
              set({ busy: false });
              listProposals();
            });
          },
          discard: function (proposalId) {
            set({ busy: true, error: null });
            call(ctx.connection.rpc, 'discardProposal', { proposal_id: proposalId }).then(function (result) {
              if (!settle(result)) return;
              set({ busy: false });
              listProposals();
            });
          },
          setImportMd: function (v) { set({ importMd: v, notice: null }); },
          importMarkdown: function () {
            var text = current().importMd;
            if (text.trim() === '') return;
            set({ busy: true, error: null, notice: null });
            call(ctx.connection.rpc, 'importMarkdown', { documents: splitMarkdown(text) }).then(function (result) {
              if (!settle(result)) return;
              var value = result.value || {};
              set({ busy: false, notice: t('imported') + ' (' + String(value.created) + ', failed ' + String(value.failed) + ')' });
              loadDocs();
            });
          },
          setRepoPath: function (v) { set({ repoPath: v, notice: null }); },
          importRepo: function () {
            var path = current().repoPath.trim();
            if (path === '') return;
            set({ busy: true, error: null, notice: null });
            call(ctx.connection.rpc, 'importRepo', { repo_path: path }).then(function (result) {
              if (!settle(result)) return;
              var value = result.value || {};
              set({ busy: false, notice: t('imported') + ' (' + String(value.created) + ', engine ' + value.engine + ')' });
              loadDocs();
            });
          },
          setMemberDraft: setMemberDraft,
          setConfirmRemove: function (memberUserId) { set({ confirmRemove: memberUserId }); },
          saveMember: function (memberUserId, level) {
            set({ busy: true, error: null });
            call(ctx.connection.rpc, 'setMember', { member_user_id: memberUserId, level: level }).then(function (result) {
              if (!settle(result)) return;
              set({ busy: false });
              listMembers();
            });
          },
          addMember: function () {
            var draft = current().memberDraft;
            var userId = Number.parseInt(draft.userId, 10);
            if (!Number.isFinite(userId)) { set({ error: t('memberUser') }); return; }
            ui.saveMember(userId, draft.level);
          },
          testSource: function () {
            set({ busy: true, error: null });
            call(ctx.connection.rpc, 'testSource', {}).then(function (result) {
              if (!settle(result)) return;
              var value = result.value || {};
              var status = value.source || null;
              var sources = current().sources.slice();
              if (status !== null) {
                var replaced = false;
                sources = sources.map(function (existing) {
                  if (existing.id === status.id) { replaced = true; return status; }
                  return existing;
                });
                if (!replaced) sources.push(status);
              }
              set({ busy: false, sources: sources });
            });
          },
        };

        // 身份探测:listAccounts 非 admin 只返回本人账号 —— 缺席/未登录即匿名。
        loadAccounts();

        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_KEY,
            order: 30,
            locale: NS,
            label: function () { return t('title'); },
          }, function KnowledgeIcon(props) {
            return h('svg', {
              viewBox: '0 0 24 24', width: props.size || 20, height: props.size || 20,
              fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
              strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
            },
            h('path', { d: 'M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z' }),
            h('path', { d: 'M14 4v5h5' }),
            h('path', { d: 'M8.5 13.5h7M8.5 17h4.5' }));
          });
        });

        ctx.slots.inject('main', function () {
          return ctx.slots.register({
            name: 'main',
            key: PANEL_KEY,
            locale: NS,
            inject: function () { return { hooks: { kbState: source }, ui: ui, t: t }; },
          }, function KnowledgeMainPanel(props) {
            return h(KnowledgePanel, Object.assign({}, props.ui, {
              state: props.useKbState(function (s) { return s; }),
              ui: props.ui,
              t: props.t,
            }));
          });
        });

        ctx.effect(function () {
          return function () { disposers.forEach(function (dispose) { dispose(); }); };
        });
      },
    };
  },
});
