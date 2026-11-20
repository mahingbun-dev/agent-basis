/**
 * 生成 hero 浮层静态对照页（证据用，非产品入口）。
 *
 * 输入 = 出厂的 packages/brand/lib/client.js：在 vm 里以伪 document 驱动
 * apply，捕获 [令牌桥接 CSS] 与 [HERO_CSS]，再用伪 react 调用注册的
 * conversation.hero.frame 组件得到真实元素树，序列化成 HTML。
 * 宿主壳（.root position:relative / isolation:isolate / flex column、
 * .scroll 滚动体、输入卡）按上游 ui-conversation 的骨架手写，仅供截图与
 * 命中面断言，不代表完整 DSH 应用。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'

const ROOT = '/Users/sunny/code/agent-basis-rc5'
const OUT = `${ROOT}/artifacts/rc5/p4/hero`
const bundle = readFileSync(`${ROOT}/packages/brand/lib/client.js`, 'utf8')

/** 伪 React：函数组件直接求值，宿主元素返回 vnode。 */
function createElement(type, props, ...children) {
  if (typeof type === 'function') return type({ ...(props ?? {}), children })
  return { type, props: props ?? {}, children: children.flat(Infinity) }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (value) => String(value).replace(/[&<>"]/gu, char => ESC[char])

function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  const attrs = []
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'children' || value === undefined || value === null || value === false) continue
    if (key === 'style' && typeof value === 'object') {
      const css = Object.entries(value).map(([name, v]) => `${name.replace(/[A-Z]/gu, m => `-${m.toLowerCase()}`)}:${v}`).join(';')
      attrs.push(`style="${esc(css)}"`)
    } else if (key === 'className') {
      attrs.push(`class="${esc(value)}"`)
    } else {
      attrs.push(`${key}="${esc(value === true ? '' : value)}"`)
    }
  }
  const inner = node.children.map(serialize).join('')
  return `<${node.type}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>${inner}</${node.type}>`
}

/** 捕获样式节点。 */
const nodes = []
function fakeNode(tag) {
  const node = {
    tag, id: '', textContent: '', attrs: {},
    setAttribute(name, value) { node.attrs[name] = value },
    remove() {},
  }
  return node
}
const document = {
  title: 'EternaAgent',
  head: { append: (node) => { nodes.push(node) } },
  body: { setAttribute() {}, removeAttribute() {} },
  documentElement: {},
  querySelector(selector) {
    if (selector === 'title') return null
    if (selector.startsWith('#')) return nodes.find(node => node.id === selector.slice(1)) ?? null
    const attr = /^style\[([a-z-]+)\]$/u.exec(selector)
    if (attr !== null) return nodes.find(node => node.attrs[attr[1]] !== undefined) ?? null
    return null
  },
  querySelectorAll() { return [] },
  createElement: fakeNode,
  createTreeWalker() { return { nextNode: () => null } },
}

const registrations = []
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (spec) => {
        const exports = spec.factory((name) => name === 'react' ? { createElement } : undefined)
        sandbox.exports = exports
      },
    },
  },
  document,
  MutationObserver: class { observe() {} disconnect() {} },
  NodeFilter: { SHOW_TEXT: 4 },
  Node: { TEXT_NODE: 3 },
  CSS: { escape: (value) => value },
  Element: function ElementStub() {},
}
vm.createContext(sandbox)
vm.runInContext(bundle, sandbox)
sandbox.exports.apply({
  slots: {
    inject(_name, contribute) { contribute(); return () => undefined },
    register(options, component) {
      registrations.push({ name: options.name, id: options.id, component })
      return () => undefined
    },
  },
})

const tokensCss = nodes.find(node => node.id === 'eterna-ui-tokens')?.textContent ?? ''
const heroCss = nodes.find(node => node.attrs['data-eterna-hero-styles'] !== undefined)?.textContent ?? ''
if (tokensCss === '' || heroCss === '') throw new Error('样式捕获失败')

const heroFrame = registrations.find(entry => entry.name === 'conversation.hero.frame')?.component
if (typeof heroFrame !== 'function') throw new Error('hero.frame 未注册')

const heroMark = registrations.find(entry => entry.name === 'conversation.hero.brand.mark')?.component
if (typeof heroMark !== 'function') throw new Error('hero.brand.mark 未注册')

/** 首屏标题行：上游 EmptyHero 的 fishHitbox + 34px 品牌标 + 标题
 * （标题文案已按品牌规则改写为「方寸灵台，运筹万里」）。 */
const headline = createElement('div', { className: 'headline' },
  createElement('span', { className: 'fish-hitbox' }, heroMark({ size: 34, className: 'hero-fish' })),
  createElement('span', { className: 'headline-text' }, '方寸灵台，运筹万里'))

/** 宿主滚动体 + 输入卡（ui-conversation 骨架的最小同构）。 */
const content = createElement('div', { className: 'scroll', 'data-conversation-scroll': '' },
  // 首屏区（标题行 + 输入卡）置顶，保证截图/命中测试在首屏可见；
  // 其后再放长列表，用来验证滚动体仍可滚动（装饰层不改滚动布局）。
  createElement('div', { className: 'hero-stage' }, headline),
  createElement('div', { className: 'composer-holder' },
    createElement('div', { className: 'composer-card', 'data-composer-card': '' },
      createElement('input', { className: 'composer-input', placeholder: '给 Agent 发消息…' }),
      createElement('button', { className: 'composer-send', type: 'button' }, '发送'))),
  ...Array.from({ length: 12 }, (_, index) => createElement('div', { className: 'message' },
    `第 ${index + 1} 条会话内容：方寸灵台，运筹万里。`)))

const tree = heroFrame({ hero: true, children: content })

const harnessCss = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font-family: var(--et-font-body); color: var(--et-fg); background: var(--et-bg); }
.app { display: flex; height: 100vh; }
/* 宿主 ConversationRoot 骨架：position:relative 是品牌层的定位上下文，
   hero 阶段 isolation:isolate 让 z-index:-1 落在背景之上、内容之下。 */
.root { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; height: 100%; background: var(--et-bg); }
.root[data-phase='hero'] { isolation: isolate; }
.scroll { position: relative; flex: 1 1 auto; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.message { padding: 12px 16px; border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm); background: var(--et-surface); color: var(--et-fg-2); font-size: 13px; }
.hero-stage { display: flex; justify-content: center; padding: 72px 0 8px; }
.headline { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 24px; line-height: 1.25; font-weight: 600; color: var(--et-fg); }
.fish-hitbox { display: inline-flex; flex: none; align-items: center; justify-content: center; }
.hero-fish { display: block; overflow: visible; color: var(--et-fg); }
.composer-holder { margin-top: 24px; }
.composer-card { display: flex; gap: 8px; padding: 12px; border: 1px solid var(--et-border); border-radius: var(--et-radius-md); background: var(--et-surface); }
.composer-input { flex: 1 1 auto; min-height: 40px; padding: 0 12px; border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm); background: var(--et-surface-2); color: var(--et-fg); font-family: var(--et-font-body); font-size: 15px; }
.composer-send { flex: none; padding: 0 16px; border: 0; border-radius: var(--et-radius-sm); background: var(--et-accent-fill); color: var(--et-accent-on); font-size: 13px; }
`

function page(theme) {
  const dark = theme === 'dark'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>hero harness (${theme})</title>
<style>${tokensCss}</style>
<style>${heroCss}</style>
<style>${harnessCss}</style>
</head>
<body${dark ? ' data-ds-dark-theme=""' : ''} data-eterna-ui="">
<div class="app">
  <div class="root" data-phase="hero" id="root">
    ${serialize(tree)}
  </div>
</div>
</body>
</html>`
}

writeFileSync(`${OUT}/harness-light.html`, page('light'))
writeFileSync(`${OUT}/harness-dark.html`, page('dark'))
console.log(JSON.stringify({
  tokensCssBytes: Buffer.byteLength(tokensCss),
  heroCssBytes: Buffer.byteLength(heroCss),
  htmlBytesLight: Buffer.byteLength(page('light')),
  registrations: registrations.map(entry => ({ name: entry.name, id: entry.id ?? null })),
}, null, 2))
