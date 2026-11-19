// 离线渲染烟测:极简 React 兼容层把整棵面板树渲染成 HTML,校验装配/组件/状态切片/字典键。
//
// 2026-11-19 融合改造后读**构建产物** lib/client.js(esbuild 打包,@eterna/ui/icon-data 已内联),
// 并新增两项契约断言:
//  1. 面板驱动过的 RPC 方法集合 ≡ 18 个端点(每个 ui 动作至少覆盖一次;方法名漂移即红);
//  2. 账号作用域:除 listAccounts 外,每个请求都显式带 `account`(admin 切换器/普通本人);
//     账号切换器仅在管理员态渲染(details/listbox),普通账号只显示静态标签。
const fs = require('fs'), vm = require('vm')
const code = fs.readFileSync(require('path').resolve(__dirname, '../lib/client.js'), 'utf8')

function makeReact() {
  function createElement(type, props) {
    const args = Array.prototype.slice.call(arguments, 2)
    const p = Object.assign({}, props || {})
    if (args.length === 1) p.children = args[0]
    else if (args.length > 1) p.children = args
    return { type, props: p }
  }
  return { createElement }
}

function render(node, depth) {
  if (depth > 40) throw new Error('render depth exceeded')
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => render(n, depth + 1)).join('')
  const { type, props } = node
  delete props.key
  const kids = render(props.children, depth + 1)
  if (typeof type === 'function') {
    const out = type(props)
    return render(out, depth + 1)
  }
  const attrs = Object.keys(props)
    .filter((k) => k !== 'children' && /^data-|^(type|value|disabled|role|href|title|placeholder|aria-|viewBox|stroke|fill|style)/.test(k) && props[k] !== undefined)
    .map((k) => ` ${k}="${String(props[k]).replace(/"/g, '&quot;')}"`).join('')
  return `<${type}${attrs}>${kids}</${type}>`
}

/** 面板可调用的 18 端点(与 types.ts KNOWLEDGE_ADMIN_METHOD_SPECS 逐字同步;漂移即红)。 */
const METHODS = [
  'listAccounts', 'overview', 'listDocs', 'readDoc', 'saveDoc',
  'deprecateDoc', 'undoDeprecate', 'listProposals', 'reviewProposal', 'discardProposal',
  'search', 'ask', 'importMarkdown', 'importRepo', 'listMembers',
  'setMember', 'listAudit', 'testSource',
]

const grabbed = []
const slots_ = []
const dictionaries = {}
const rpcCalls = []
const ctx = {
  slots: { inject(name, fn) { fn(); return () => {} }, register(options, component) { slots_.push({ options, component }); return () => {} } },
  locale: {
    register(ns, dicts) { dictionaries[ns] = dicts; return () => {} },
    bind(ns) { return (key) => { const d = dictionaries[ns]; const v = d && (d.zh[key] !== undefined ? d.zh[key] : d.en[key]); return v === undefined ? '[!' + key + '!]' : v } },
  },
  connection: {
    rpc: {
      call(channel, endpoint, payload) {
        rpcCalls.push({ endpoint, payload })
        // 双层封套:外层连接层 {ok,value},内层 access 守卫 KnowledgeResult {ok,value}
        if (endpoint === 'knowledgeAdmin/deprecateDoc') {
          return Promise.resolve({ ok: true, value: { ok: true, value: { doc_id: 'd1', deprecated: true, undo_available: true, undo_token: 'tok', undo_hint: '30 分钟内可撤销' } } })
        }
        if (endpoint === 'knowledgeAdmin/listAccounts') {
          return Promise.resolve({ ok: true, value: { ok: true, value: { accounts: [
            { account: '*', global: true, available: true, self: false, wiki_dir: '/x', db_path: '/x' },
            { account: 'alice', global: false, available: true, self: true, wiki_dir: '/a', db_path: '/a' },
          ] } } })
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: {} } })
      },
    },
  },
  effect(fn) { fn(); return () => {} },
}
const styleNode = { setAttribute() {}, remove() {}, textContent: '' }
const document = {
  querySelector: () => null,
  createElement: () => styleNode,
  head: { append() {} },
  body: { append() {} },
}
const sandbox = { window: {}, document, console, Set, Promise, Object, String, Number, Math, Array, JSON, RegExp, Map, Date, Error, undefined, setTimeout, clearTimeout }
sandbox.window.__ModuleLoader__ = { load(mod) { grabbed.push(mod) } }
sandbox.window.setTimeout = setTimeout
const context = vm.createContext(sandbox)
vm.runInContext(code, context)
const mod = grabbed[0]
if (!mod || mod.id !== '@eterna/knowledge-admin') throw new Error('module id mismatch')
const plugin = mod.factory(makeReactFactory)
function makeReactFactory(name) {
  if (name === 'react') return makeReact()
  throw new Error('unexpected external require: ' + name)
}
if (typeof plugin.apply !== 'function') throw new Error('apply missing')
plugin.apply(ctx)
if (slots_.length < 2) throw new Error('slots registered: ' + slots_.length)

const dict = dictionaries['eternaKnowledgeAdmin']
const needed = []
const zhKeys = Object.keys(dict.zh)
const enKeys = Object.keys(dict.en)
if (zhKeys.length !== enKeys.length) throw new Error('zh/en key count differ: ' + zhKeys.length + ' vs ' + enKeys.length)
zhKeys.concat(enKeys).forEach((k) => { if (needed.indexOf(k) < 0) needed.push(k) })

const main = slots_.filter((g) => g.options.name === 'main')[0]
const sidebar = slots_.filter((g) => g.options.name === 'sidebar.panellist')[0]
if (!main || !sidebar) throw new Error('missing slot registration')
if (main.options.key !== 'eterna-knowledge-admin' || sidebar.options.id !== 'eterna-knowledge-admin') throw new Error('slot key/id mismatch')

const injected = main.options.inject()
const t = injected.t
const ui = injected.ui
const hook = injected.hooks.kbState
const S = () => hook.getSnapshot()
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

;(async () => {
  await tick() // 初次 loadAccounts → overview → listDocs 链

  // 驱动全部 ui 动作(每个动作至少触发一次端点;方法集合必须恰好 18 个)
  ui.refresh()
  ui.setTab('proposals'); await tick()
  ui.setTab('members'); await tick()
  ui.setTab('audit'); await tick()
  ui.setTab('docs'); await tick()
  ui.setQuery('关键词'); ui.search(); await tick()
  ui.openDoc('d1'); await tick()
  ui.setDraft({ title: 't', body: 'b', tags: 'a, b', origin: 'o', docId: 'd1', path: 'p' }); ui.saveDraft(); await tick()
  ui.deprecate('d1'); await tick() // 缺少取代者 → 客户端前置拒绝(不调 RPC)
  if (rpcCalls.some((c) => c.endpoint === 'knowledgeAdmin/deprecateDoc')) throw new Error('缺取代者时不应调用 deprecateDoc')
  ui.setSuccessor('d2'); ui.deprecate('d1'); await tick()
  if (S().undo === null) throw new Error('deprecate 后 undo 句柄未保存')
  ui.undoDeprecate(); await tick()
  ui.setAsk({ question: 'q' }); ui.askQuestion(); await tick()
  ui.review('p1', 'approve'); await tick()
  ui.discard('p1'); await tick()
  ui.setImportMd('# 标题\n正文'); ui.importMarkdown(); await tick()
  ui.setRepoPath('projects/x'); ui.importRepo(); await tick()
  ui.setMemberDraft({ userId: '7' }); ui.addMember(); await tick()
  ui.testSource(); await tick()
  // 管理员态 + 账号切换:切到 alice 会把后续分库请求带上 alice
  hook.publish((s) => Object.assign({}, s, {
    auth: 'authenticated', admin: true,
    accounts: [
      { account: '*', global: true, available: true, self: false },
      { account: 'alice', global: false, available: true, self: true },
    ],
    account: '*',
  }))
  ui.selectAccount('alice'); await tick()

  const used = rpcCalls.map((c) => c.endpoint.replace('knowledgeAdmin/', ''))
  const unique = used.filter((m, i) => used.indexOf(m) === i).sort()
  const expected = METHODS.slice().sort()
  if (JSON.stringify(unique) !== JSON.stringify(expected)) {
    throw new Error('RPC 方法集合漂移:\n实际=' + unique.join(',') + '\n期望=' + expected.join(','))
  }
  const unscoped = rpcCalls.filter((c) => {
    if (c.endpoint === 'knowledgeAdmin/listAccounts') return false
    const args = c.payload && c.payload.args
    return args === undefined || typeof args.account !== 'string' || args.account === ''
  })
  if (unscoped.length > 0) throw new Error('分库请求未显式带 account: ' + unscoped.map((c) => c.endpoint).join(','))
  if (!rpcCalls.some((c) => c.endpoint === 'knowledgeAdmin/listDocs' && c.payload.args.account === 'alice')) {
    throw new Error('切换账号后请求未带新 account(alice)')
  }

  // 渲染:各 tab + 匿名 + 管理员切换器 + 普通静态标签
  let html = ''
  const trees = []
  const adminState = S()
  for (const tab of ['docs', 'edit', 'ask', 'proposals', 'import', 'members', 'audit']) {
    adminState.tab = tab
    const tree = main.component({ t, ui, state: adminState, useKbState: (sel) => sel(adminState) })
    trees.push(tree)
    html += render(tree, 0)
  }
  if (!html.includes('data-kb="switcher"')) throw new Error('管理员态未渲染账号切换器')
  if (!html.includes('全局知识库')) throw new Error('切换器缺全局库选项')
  const normalState = Object.assign({}, adminState, { admin: false, accounts: [{ account: 'alice', global: false, available: true, self: true }], account: 'alice', tab: 'docs' })
  const normalTree = main.component({ t, ui, state: normalState, useKbState: (sel) => sel(normalState) })
  trees.push(normalTree)
  const normalHtml = render(normalTree, 0)
  if (normalHtml.includes('data-kb="switcher"')) {
    throw new Error('普通账号不应渲染账号切换器(静态标签即可)')
  }
  if (!normalHtml.includes('alice')) throw new Error('普通账号静态标签未显示本人')
  html += normalHtml
  const anonymous = Object.assign({}, normalState, { auth: 'anonymous' })
  const anonymousTree = main.component({ t, ui, state: anonymous, useKbState: (sel) => sel(anonymous) })
  trees.push(anonymousTree)
  html += render(anonymousTree, 0)
  html += render(sidebar.component({ size: 20 }), 0)

  const broken = html.match(/\[![^\]]+\]/g) || []
  if (broken.length) throw new Error('missing dictionary keys: ' + broken.join(','))
  if (!html.includes('data-kb="root"')) throw new Error('no root anchor rendered')

  // ── 标记 ↔ 样式覆盖率（#126 沉淀；合并版支持逗号分组选择器）──────────
  // 本插件样式全挂在 [data-kb='X'] 上；用了标记却没有「以它为主语」的规则，
  // 该块 UI 就退化成浏览器默认排版（Toolbar 缺 bar 规则、390 每按钮一整行）。
  // 按块解析选择器列表：[data-kb='input'],[data-kb='textarea']{...} 每个都算覆盖；
  // 后代/兄弟选择器（> + ~ 空格）不算——删掉主规则不能靠后代规则骗过。
  const usedMarkers = new Set()
  for (const m of html.matchAll(/data-kb[=:]\s*["']?([a-z0-9-]+)/g)) usedMarkers.add(m[1])
  const styledMarkers = new Set()
  for (const block of styleNode.textContent.split('}')) {
    const brace = block.indexOf('{')
    if (brace < 0) continue
    for (const raw of block.slice(0, brace).split(',')) {
      const sel = raw.trim()
      const rule = sel.match(/^\[data-kb='([a-z0-9-]+)'\]((?::[a-z-]+)?(?:\[[^\]]*\])*)$/)
      if (rule === null) continue
      const suffix = rule[2] || ''
      if (/[>+~ ]/.test(suffix)) continue
      styledMarkers.add(rule[1])
    }
  }
  if (usedMarkers.size === 0) throw new Error('no data-kb markers found in rendered html')
  if (styledMarkers.size === 0) throw new Error('no [data-kb=...] rules found in CSS')
  const unstyled = [...usedMarkers].filter((k) => !styledMarkers.has(k))
  if (unstyled.length) throw new Error('渲染用到但没有样式的 data-kb 标记: ' + unstyled.join(', '))
  console.log('markers: used=' + usedMarkers.size + ' styled=' + styledMarkers.size + ' (all covered)')

  // 触控高度：v4「触控 ≥36px」；按钮/输入按共享基础件取 40px。
  const btnRule = styleNode.textContent.match(/\[data-kb='btn'\]\{([^}]*)\}/)
  if (!btnRule) throw new Error("missing [data-kb='btn'] base rule")
  const btnH = Number((btnRule[1].match(/height:(\d+)px/) || [])[1])
  if (!(btnH >= 36)) throw new Error('[data-kb=btn] 触控高度不足 36px: ' + btnH)
  const inputRule = styleNode.textContent.match(/\[data-kb='input'\][^{]*\{([^}]*)\}/)
  const inputH = Number((((inputRule || [])[1] || '').match(/height:(\d+)px/) || [])[1])
  if (inputH > 0 && inputH < 36) throw new Error('[data-kb=input] 高度不足 36px: ' + inputH)

  // 字面色值：样式全走 --et-*（历史事故：23 处字面色 + 9 个上游不存在的别名）。
  const literals = styleNode.textContent.match(/#[0-9a-fA-F]{3,8}|rgba?\(/g) || []
  if (literals.length) throw new Error('CSS 里出现字面色值: ' + literals.join(','))

  // 事件处理器冒烟:把每棵渲染树里的 onClick 全触发一遍(假事件),同步抛错即红。
  // 覆盖「按钮误调 state.askQuestion 这类只在真人点击时炸」的缺陷——离线断言调的是 ui,
  // 走不到按钮绑定的闭包;askQuestion 按钮曾经真的绑错。
  function collectClicks(node, out, depth) {
    if (depth > 40 || node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((child) => collectClicks(child, out, depth + 1))
      return
    }
    if (typeof node.type === 'function') {
      collectClicks(node.type(node.props), out, depth + 1)
      return
    }
    if (node.props && typeof node.props.onClick === 'function') out.push(node.props.onClick)
    if (node.props) collectClicks(node.props.children, out, depth + 1)
  }
  const fakeEvent = { currentTarget: { closest: () => ({ open: false }) } }
  let invoked = 0
  for (const tree of trees) {
    const handlers = []
    collectClicks(tree, handlers, 0)
    for (const handler of handlers) {
      invoked += 1
      try {
        handler(fakeEvent)
      } catch (error) {
        throw new Error('onClick 抛错(第 ' + invoked + ' 个): ' + (error && error.message))
      }
    }
  }
  if (invoked < 20) throw new Error('onClick 覆盖过少: ' + invoked)
  fs.writeFileSync('/tmp/kb-render.html', html)
  console.log('onClick handlers invoked: ' + invoked)
  console.log('render ok: slots=' + slots_.length + ' dict=' + zhKeys.length + ' methods=' + unique.length + ' html=' + html.length + ' bytes')
  console.log('UI handlers: ' + Object.keys(ui).length + ', state keys: ' + Object.keys(S()).length)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})