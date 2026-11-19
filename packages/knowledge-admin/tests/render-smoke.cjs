// 离线渲染烟测:极简 React 兼容层把整棵面板树渲染成 HTML,校验装配/组件/状态切片/字典键。
const fs = require('fs'), vm = require('vm')
const code = fs.readFileSync(require('path').resolve(__dirname, '../src/client/index.js'), 'utf8')

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

const grabbed = []
const slots_ = []
const dictionaries = {}
let slotName = null
const ctx = {
  slots: { inject(name, fn) { slotName = name; fn(); return () => {} }, register(options, component) { slots_.push({ options, component }); return () => {} } },
  locale: {
    register(ns, dicts) { dictionaries[ns] = dicts; return () => {} },
    bind(ns) { return (key) => { const d = dictionaries[ns]; const v = d && (d.zh[key] !== undefined ? d.zh[key] : d.en[key]); return v === undefined ? '[!' + key + '!]' : v } },
  },
  connection: { rpc: { call: () => Promise.resolve({ ok: true, value: {} }) } },
  effect(fn) { fn(); return () => {} },
}
const styleNode = { setAttribute() {}, remove() {}, textContent: '' }
const document = {
  querySelector: () => null,
  createElement: () => styleNode,
  head: { append() {} },
  body: { append() {} },
}
const sandbox = { window: {}, document, console, Set, Promise, Object, String, Number, Math, Array, JSON, RegExp, Map, Date, Error, undefined }
sandbox.window.__ModuleLoader__ = { load(mod) { grabbed.push(mod) } }
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
if (zhKeys.length !== enKeys.length) throw new Error('zh/en key count differ')
zhKeys.concat(enKeys).forEach((k) => { if (needed.indexOf(k) < 0) needed.push(k) })

const main = slots_.filter((g) => g.options.name === 'main')[0]
const sidebar = slots_.filter((g) => g.options.name === 'sidebar.panellist')[0]
if (!main || !sidebar) throw new Error('missing slot registration')
if (main.options.key !== 'eterna-knowledge-admin' || sidebar.options.id !== 'eterna-knowledge-admin') throw new Error('slot key/id mismatch')

const injected = main.options.inject()
const t = injected.t
const ui = injected.ui
const state = injected.hooks.kbState.getSnapshot()
// 各 tab 都渲染一遍(覆盖所有 pane 的组件路径)
const tabs = ['docs', 'edit', 'ask', 'proposals', 'import', 'members', 'audit']
let html = ''
for (const tab of tabs) {
  state.tab = tab
  html += render(main.component({ t, ui, state, useKbState: (sel) => sel(state) }), 0)
}
state.auth = 'anonymous'
html += render(main.component({ t, ui, state, useKbState: (sel) => sel(state) }), 0)
state.auth = 'authenticated'
// 侧栏图标
html += render(sidebar.component({ size: 20 }), 0)

const missing = needed.filter((k) => !t(k).startsWith('[') === false && t(k).startsWith('[!'))
const broken = html.match(/\[![^\]]+\]/g) || []
if (broken.length) throw new Error('missing dictionary keys: ' + broken.join(','))

// ── 标记 ↔ 样式覆盖率（2026-11-19 缺陷沉淀）──────────────────────────
// 本插件样式全挂在 [data-kb='X'] 上。代码用了标记却没有规则，那块 UI 就退化成
// 浏览器默认排版：Toolbar 缺 data-kb='bar' 规则时，按钮与计数挤成一串、390 下
// 每个按钮各占一整行（生产实测）。渲染烟测能抓——html 带着所有标记，styleNode
// 带着整份 CSS。
const usedMarkers = new Set()
for (const m of html.matchAll(/data-kb[=:]\s*["']?([a-z0-9-]+)/g)) usedMarkers.add(m[1])
// 只认「以该标记作为主语」的规则块：`[data-kb='bar']{...}`、`[data-kb='bar']:hover{...}`、
// `[data-kb='bar'][data-tone='primary']{...}`。后代/兄弟选择器（`[data-kb='bar']>[...]`）
// 不算给 bar 本身定义了样式——否则删掉主规则也能骗过检查（已实测复现两次）。
const styledMarkers = new Set()
for (const m of styleNode.textContent.matchAll(/(?:^|\n)[ \t]*\[data-kb='([a-z0-9-]+)'\]((?::[:a-z-]*)?(?:\[[^\]]*\])*)\{/g)) {
  // 紧跟的后缀里出现 > + ~ 或空格，说明是后代/兄弟选择器，主语不是它本身。
  const suffix = m[2] || ''
  if (suffix.includes('>') || suffix.includes('+') || suffix.includes('~') || suffix.includes(' ')) continue
  styledMarkers.add(m[1])
}
if (usedMarkers.size === 0) throw new Error('no data-kb markers found in rendered html')
if (styledMarkers.size === 0) throw new Error('no [data-kb=...] rules found in CSS')
const unstyled = [...usedMarkers].filter((k) => !styledMarkers.has(k))
if (unstyled.length) throw new Error('渲染用到但没有样式的 data-kb 标记: ' + unstyled.join(', '))
console.log('markers: used=' + usedMarkers.size + ' styled=' + styledMarkers.size + ' (all covered)')

// 触控高度：v4 规范「触控 ≥36px」；按钮与输入按共享基础件取 40px。
const btnRule = styleNode.textContent.match(/\[data-kb='btn'\]\{([^}]*)\}/)
if (!btnRule) throw new Error("missing [data-kb='btn'] base rule")
const btnH = Number((btnRule[1].match(/height:(\d+)px/) || [])[1])
if (!(btnH >= 36)) throw new Error('[data-kb=btn] 触控高度不足 36px: ' + btnH)
const inputRule = styleNode.textContent.match(/\[data-kb='input'\][^{]*\{([^}]*)\}/)
const inputH = Number((((inputRule || [])[1] || '').match(/height:(\d+)px/) || [])[1])
if (inputH > 0 && inputH < 36) throw new Error('[data-kb=input] 高度不足 36px: ' + inputH)

// 字面色值：样式必须全走 --et-*（历史事故：23 处字面色 + 9 个上游不存在的别名）。
const literals = styleNode.textContent.match(/#[0-9a-fA-F]{3,8}|rgb\(|rgba\(/g) || []
if (literals.length) throw new Error('CSS 里出现字面色值: ' + literals.join(','))

if (!html.includes('data-kb="root"') && !html.includes('data-kb=root')) throw new Error('no root anchor rendered')
fs.writeFileSync('/tmp/kb-render.html', html)
console.log('render ok: slots=' + slots_.length + ' dict=' + zhKeys.length + ' html=' + html.length + ' bytes')
console.log('UI handlers: ' + Object.keys(ui).length + ', state keys: ' + Object.keys(state).length)
