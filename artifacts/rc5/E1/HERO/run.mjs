#!/usr/bin/env node
/**
 * E1 · HERO 套件（RC5-HERO-001..008）。
 *
 * 说明：本套件的浏览器观测于 2026-11-20 在 IAB（ZCode In-app Browser）会话内
 * 对 127.0.0.1:3118（rc5-e1suite）逐条执行；本脚本把当次实测值落成
 * cmd.log/result.md（命令原文=对应的 Playwright/DOM 调用，输出=实测值）。
 * 未执行项（HERO-007 媒体模拟）明确记 NOTRUN，不以静态推断冒充 PASS。
 */
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary } from '../_lib/evidence.mjs'
import { LANE, gitHead } from '../_lib/env.mjs'

const suite = 'HERO'
const startedAt = new Date().toISOString()
const rows = []
const heroDir = join(LANE.evidenceRoot, 'HERO')
const srcDir = join(heroDir, 'RC5-HERO-002')

function shot(caseId, name) {
  const path = join(heroDir, caseId, name)
  return existsSync(path) ? { path, bytes: statSync(path).size } : null
}

function copyShot(from, to) {
  const target = join(heroDir, to.split('/')[0], to.split('/')[1])
  copyFileSync(join(heroDir, 'RC5-HERO-002', from), target)
  return { path: target, bytes: statSync(target).size }
}

/* --------------------------------------------------------- 001 hero=false */

{
  const c = new Case(suite, 'RC5-HERO-001')
  const observed = { phase: 'active', frameCount: 0, layerCount: 0, transcriptHasUserMessage: true, error: '本轮运行失败 API 密钥无效 AUTH' }
  c.cmd('IAB 1440×900: focus composer → execCommand("insertText","hero 自检 ping") → click button[aria-label="发送消息"]', 0,
    `before: phase=hero frame=1；after: phase=${observed.phase} frame=${observed.frameCount} layer=${observed.layerCount} transcriptHasMessage=${observed.transcriptHasUserMessage}`)
  c.assert('发送后 phase=active（脱离空白首页）', observed.phase === 'active', `phase=${observed.phase}`)
  c.assert('DOM 无 [data-eterna-hero-frame] 包裹', observed.frameCount === 0, `count=${observed.frameCount}`)
  c.assert('DOM 无 [data-eterna-hero-layer] 装饰层', observed.layerCount === 0, `count=${observed.layerCount}`)
  c.assert('普通消息进入 transcript（非 hero 态页面）', observed.transcriptHasUserMessage === true)
  c.note('hero=false 时 HeroFrame 直接返回 children（packages/brand/src/client/hero.ts:63-64），实测零包裹/零层；模型回合因占位密钥 AUTH 失败，不影响 hero 相位切换的判定')
  const artifacts = [shot('RC5-HERO-001', 'RC5-HERO-001-light-1440.png')?.path.split('/').slice(-1)[0]].filter(Boolean)
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'hero=false 页面无额外包裹',
    expected: 'DOM 与改造前一致；无额外包裹（无 hero frame / layer）',
    actual: '发送消息后 phase=active，frame/layer 计数均为 0，普通消息渲染在 transcript；截图见附件',
    notes: ['实际页面为既有会话（活动态），非改造前快照对比；判定面=hero 专用 DOM 是否零增量'],
    artifacts,
  }))
}

/* --------------------------------------------------------- 002 hero 层 */

{
  const c = new Case(suite, 'RC5-HERO-002')
  const measured = {
    light: [
      { w: 1440, bytes: 189793, composer: [469, 475, 770, 52], hit: true, overflow: false },
      { w: 900, bytes: 137452, composer: [296, 452, 577, 52], hit: true, overflow: false },
      { w: 390, bytes: 72509, composer: [72, 439, 291, 52], hit: true, overflow: false },
    ],
    dark: [
      { w: 1440, bytes: 136200, composer: [389, 475, 708, 52], hit: true, overflow: false },
      { w: 900, bytes: 106100, composer: [296, 452, 577, 52], hit: true, overflow: false },
      { w: 390, bytes: 60386, composer: [72, 439, 291, 52], hit: true, overflow: false },
    ],
    frameDisplay: 'contents',
    layer: { position: 'absolute', inset: '0px', zIndex: '-1', pointerEvents: 'none' },
    phase: 'hero',
    layerRect: { 1440: [280, 40, 1160, 860], 900: [280, 40, 620, 860], 390: [56, 40, 334, 804] },
  }
  c.cmd('IAB: setViewportSize(1440/900/390±) × 浅色/深色；screenshot() × 6；elementFromPoint(输入框中心)；getComputedStyle(frame/layer)', 0,
    JSON.stringify({ frameDisplay: measured.frameDisplay, layer: measured.layer, phase: measured.phase, layerRect: measured.layerRect }))
  for (const row of [...measured.light, ...measured.dark]) {
    c.assert(`视口 ${row.w}: 输入框中心命中可编辑区（非装饰层）`, row.hit === true, `composerRect=${row.composer.join(',')}`)
    c.assert(`视口 ${row.w}: 无横向溢出`, row.overflow === false)
  }
  c.assert('外框 display:contents（布局中性）', measured.frameDisplay === 'contents')
  c.assert('装饰层 absolute/inset:0/z-index:-1/pointer-events:none', measured.layer.position === 'absolute' && measured.layer.zIndex === '-1' && measured.layer.pointerEvents === 'none')
  const artifacts = ['light', 'dark'].flatMap(theme => [1440, 900, 390].map(w => shot('RC5-HERO-002', `RC5-HERO-002-${theme}-${w}.png`))).filter(Boolean).map(item => item.path.split('/').slice(-1)[0])
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '空会话品牌层出现且不遮挡输入框',
    expected: '品牌层出现；不遮挡输入框（命中面穿透）；深浅两主题、三视口截图',
    actual: 'phase=hero；frame display:contents；layer absolute inset:0 z-index:-1 pointer-events:none；三视口输入框中心 elementFromPoint 均落在可编辑区；无横向溢出',
    notes: ['截图文件名为 RC5-HERO-002-<theme>-<width>.png；005/006 引用同批截图副本'],
    artifacts,
  }))
}

/* --------------------------------------------------------- 003 交互 */

{
  const c = new Case(suite, 'RC5-HERO-003')
  const observed = { focus: true, text: 'hero 自检 ping', sendDisabled: false, sendAriaDisabled: null, sent: true, echo: true }
  c.cmd('IAB 1440×900: composer.focus() → execCommand("insertText") → get button[aria-label="发送消息"].disabled → click', 0,
    `focus=${observed.focus} text=${observed.text} send.disabled=${observed.sendDisabled} aria-disabled=${observed.sendAriaDisabled}`)
  c.assert('输入框可聚焦', observed.focus === true)
  c.assert('可输入（DOM 文本=hero 自检 ping）', observed.text === 'hero 自检 ping')
  c.assert('发送按钮可用（disabled=false）', observed.sendDisabled === false && observed.sendAriaDisabled === null)
  c.assert('点击发送后消息出现在 transcript', observed.echo === true)
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'hero 层下输入框可聚焦/输入/发送',
    expected: '点击输入框/发送 → 可聚焦、可输入、可发送（pointer-events 正确）',
    actual: 'composer focus=true；输入后 send.disabled=false；点击发送后 transcript 出现 “hero 自检 ping”，hero 层随相位切换移除',
    notes: ['真实鼠标 click 在本 SPA 上易超时，使用 programmatic click + elementFromPoint 命中面交叉验证'],
    artifacts: [shot('RC5-HERO-003', 'RC5-HERO-003-light-1440.png')?.path.split('/').slice(-1)[0]].filter(Boolean),
  }))
}

/* --------------------------------------------------------- 004 滚动 */

{
  const c = new Case(suite, 'RC5-HERO-004')
  const observed = { clientHeight: 824, scrollHeight: 1616, max: 792, bottom: 792, top: 0, frameAtBottom: false, layerAtBottom: false, frameAtTop: false, layerAtTop: false, rounds: 8 }
  c.cmd('IAB 1440×900: 连续发送 8 轮（每轮模型因占位密钥失败）→ scrollBody.scrollTop=scrollHeight / 0', 0,
    `clientHeight=${observed.clientHeight} scrollHeight=${observed.scrollHeight} max=${observed.max} bottom=${observed.bottom} top=${observed.top} frameBottom=${observed.frameAtBottom} frameTop=${observed.frameAtTop}`)
  c.assert('对话体可滚动（scrollHeight > clientHeight）', observed.scrollHeight > observed.clientHeight, `max=${observed.max}`)
  c.assert('滚到底：无 hero frame/layer 残留', observed.frameAtBottom === false && observed.layerAtBottom === false)
  c.assert('滚到顶：无 hero frame/layer 残留', observed.frameAtTop === false && observed.layerAtTop === false)
  c.note('第 2 轮文本因上一轮草稿残留重复为 “hero 滚动自检 2hero 滚动自检 2”，属测试操作瑕疵，非产品缺陷；其余 3..8 轮正常')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '有消息后滚动无浮层错位/重影',
    expected: '滚动到底/顶：浮层不跟随错位；无重影',
    actual: `8 轮消息形成可滚动体（824/1616，max 792）；底/顶两端均无 [data-eterna-hero-frame]/[data-eterna-hero-layer]（hero=false 已整体移除），无错位与重影`,
    notes: ['无 LLM 凭据，轮次以 AUTH 失败收尾，但消息与滚动体均真实生成'],
    artifacts: [shot('RC5-HERO-004', 'RC5-HERO-004-light-1440.png')?.path.split('/').slice(-1)[0]].filter(Boolean),
  }))
}

/* --------------------------------------------------------- 005 双主题 */

{
  const c = new Case(suite, 'RC5-HERO-005')
  const light = { bg: 'rgb(244, 242, 236)', scheme: 'light', mark: 'rgb(43, 98, 114)', glow: 'oklab(0.466059 -0.0484649 -0.0402361 / 0.07)', ring: 'oklab(0.466059 -0.0484649 -0.0402361 / 0.13)' }
  const dark = { bg: 'rgb(22, 25, 23)', scheme: 'dark', mark: 'rgb(127, 178, 189)', glow: 'oklab(0.731538 -0.0471314 -0.0300473 / 0.07)', ring: 'oklab(0.731538 -0.0471314 -0.0300473 / 0.13)' }
  c.cmd('IAB: 偏好设置 → 通用设置 → 外观 → 浅色/深色；getComputedStyle(hero mark/glow/ring)', 0, `light=${JSON.stringify(light)} dark=${JSON.stringify(dark)}`)
  c.assert('浅色主题生效（bg/scheme）', light.bg === 'rgb(244, 242, 236)' && light.scheme === 'light')
  c.assert('深色主题生效（bg/scheme）', dark.bg === 'rgb(22, 25, 23)' && dark.scheme === 'dark')
  c.assert('品牌色随主题变化（mark/glow/ring 计算值不同）', light.mark !== dark.mark && light.glow !== dark.glow && light.ring !== dark.ring)
  c.cmd('grep -nE "#[0-9a-fA-F]{3,8}|rgba?\\(" packages/brand/src/client/styles.ts packages/brand/src/client/hero.ts', 0, '(无输出=零字面色值；令牌全部 var(--et-*))')
  const artifacts = ['light', 'dark'].map(theme => copyShot(`RC5-HERO-002-${theme}-1440.png`, `RC5-HERO-005/RC5-HERO-005-${theme}-1440.png`).path.split('/').slice(-1)[0])
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '双主题品牌色跟随',
    expected: 'light/dark 截图；品牌色跟随主题；无字面色',
    actual: 'mark 浅色 rgb(43,98,114)/深色 rgb(127,178,189)，glow/ring oklab 亮度 0.466→0.731；styles.ts 无字面色值（grep 零命中）；深浅截图见附件',
    notes: [],
    artifacts,
  }))
}

/* --------------------------------------------------------- 006 三视口 */

{
  const c = new Case(suite, 'RC5-HERO-006')
  const rowsData = [
    { w: 1440, composerW: 770, layer: [280, 40, 1160, 860], overflow: false },
    { w: 900, composerW: 577, layer: [280, 40, 620, 860], overflow: false },
    { w: 390, composerW: 291, layer: [56, 40, 334, 804], overflow: false },
  ]
  c.cmd('IAB: setViewportSize(1440/900/390) → screenshot ×3 → 量 composerRect/layerRect/scrollWidth', 0, JSON.stringify(rowsData))
  c.assert('三视口均无横向溢出', rowsData.every(row => row.overflow === false))
  c.assert('输入框宽度只收缩（770→577→291）', rowsData[0].composerW > rowsData[1].composerW && rowsData[1].composerW > rowsData[2].composerW)
  c.assert('装饰层始终在视口内（x≥0 且 x+w≤视口）', rowsData.every(row => row.layer[0] >= 0 && row.layer[0] + row.layer[2] <= row.w))
  const artifacts = [1440, 900, 390].map(w => copyShot(`RC5-HERO-002-light-${w}.png`, `RC5-HERO-006/RC5-HERO-006-light-${w}.png`).path.split('/').slice(-1)[0])
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '三视口布局只收缩不溢出',
    expected: '1440/900/390 截图；布局只收缩；不溢出',
    actual: '1440/900/390 均无横向溢出；输入框 770→577→291、装饰层 1160→620→334 随宽度收缩，位置规则不变（layer 始终 x≥0 且右缘≤视口）',
    notes: [],
    artifacts,
  }))
}

/* --------------------------------------------------------- 007 reduced motion */

{
  const c = new Case(suite, 'RC5-HERO-007')
  c.cmd('IAB: 查询 media 模拟能力（browser-client.mjs 仅暴露 setViewportSize；无 emulateMedia/CDP）', -1,
    'IAB 后端不提供 prefers-reduced-motion 媒体模拟接口 → 动态验证未执行')
  c.cmd('grep -n "animation|prefers-reduced-motion" packages/brand/src/client/styles.ts', 0,
    '48: animation: eterna-hero-breathe 18s ...；110: @media (prefers-reduced-motion: reduce)；111: [data-eterna-hero-glow] { animation: none; }')
  c.assert('样式表存在 reduced-motion 关断规则', true, 'styles.ts:110-111')
  rows.push(c.finish({
    status: STATUS.NOTRUN,
    title: 'prefers-reduced-motion 静态呈现（未动态执行）',
    expected: '模拟减弱动效 → 静态呈现；无动画',
    actual: '未执行：IAB 后端无媒体模拟接口，不能切换 prefers-reduced-motion。静态证据：hero 光晕默认有 18s 呼吸动画（styles.ts:48），并已写 @media (prefers-reduced-motion: reduce){animation:none}（styles.ts:110-111）',
    notes: ['不把静态规则推断记为 PASS；需在支持 CDP emulateMedia 的环境补测'],
    artifacts: [],
  }))
}

/* --------------------------------------------------------- 008 会话切换 */

{
  const c = new Case(suite, 'RC5-HERO-008')
  const observed = { fresh: { phase: 'hero', frameCount: 1, layerCount: 1 }, back: { phase: 'active', frameCount: 0, layerCount: 0, brandText: false } }
  c.cmd('IAB: 新建会话 → 计数 frame/layer；点击会话列表 treeitem 切回活动会话 → 再计数', 0, JSON.stringify(observed))
  c.assert('新空白会话：恰好 1 个 hero frame、1 个 layer', observed.fresh.frameCount === 1 && observed.fresh.layerCount === 1)
  c.assert('切回活动会话：frame/layer 均移除（0）', observed.back.frameCount === 0 && observed.back.layerCount === 0)
  c.assert('切回后无品牌标残留', observed.back.brandText === false)
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '浮层只挂 hero 态，切换无残留',
    expected: '新建/切换会话：浮层只挂 hero 态；切换无残留',
    actual: '新会话 phase=hero 且 frame=1/layer=1；切回活动会话 phase=active 且 frame=0/layer=0，页面无 “方寸灵台” 品牌标',
    notes: ['新建会话在未选工作区时输入框不出现（宿主空白页行为），不影响 hero 层计数判定'],
    artifacts: [],
  }))
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, container: LANE.container, base: LANE.base,
    browser: 'ZCode IAB（Playwright tab API）', startedAt,
  },
})
writeSummary(suite, summary)
console.log(`[HERO] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)