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
if (!html.includes('data-kb="root"') && !html.includes('data-kb=root')) throw new Error('no root anchor rendered')
fs.writeFileSync('/tmp/kb-render.html', html)
console.log('render ok: slots=' + slots_.length + ' dict=' + zhKeys.length + ' html=' + html.length + ' bytes')
console.log('UI handlers: ' + Object.keys(ui).length + ', state keys: ' + Object.keys(state).length)
