/**
 * 回归:entrypoint 升级重渲染的用户配置移植(docker/profile/transplant-profile.mjs)。
 *
 * 直接回归 2026-11-19 生产事故:设置页新增的 baidu-token-plan 路由在模板变更重渲染后
 * 消失,存量会话 modelSelection.lastUsed 仍指向它 → dsh-llm NO_ADAPTER。本组用例钉住
 * 三条对外行为:①用户新增 provider 跨升级保留;②模板既有 provider 不被旧值覆盖;
 * ③历史移植面(disabled 标记 / 用户追加行 / manifest dsh 块)逐字保留。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { transplantPatch, transplantManifest } from './transplant-profile.mjs'

const TEMPLATE = `# demo profile patch
- id: llm-pi-ai
  config:
    providers:
      deepseek:
        displayName: DeepSeek
        apiKeyEnv: DEEPSEEK_API_KEY
        api: openai-completions
        baseURL: https://api.deepseek.com
        models:
          - id: deepseek-flash
      opendesign:
        displayName: OpenDesign
        api: anthropic-messages
        baseURL: https://amr-link.open-design.ai
        models:
          - id: glm-5.3-flash

# 企业默认模型
- id: agent-default-model
  config:
    provider: deepseek
    model: deepseek-flash
- id: eterna-panel
  name: '@eterna/panel'
- id: runtime-flag
  name: '@deepseek-ai/plugin-x'
`

/** 旧渲染 = 模板 + 用户在设置页新增的 baidu-token-plan(整块写回)。 */
const OLD_RENDERED = `# demo profile patch
- id: llm-pi-ai
  config:
    providers:
      deepseek:
        displayName: DeepSeek
        apiKeyEnv: DEEPSEEK_API_KEY
        api: openai-completions
        baseURL: https://api.deepseek.com
        models:
          - id: deepseek-flash
      opendesign:
        displayName: OpenDesign
        api: anthropic-messages
        baseURL: https://amr-link.open-design.ai
        models:
          - id: glm-5.3-flash
      baidu-token-plan:
        apiKeyEnv: BAIDU_TOKEN_PLAN_API_KEY
        api: anthropic-messages
        baseURL: https://qianfan.baidubce.com/anthropic/tokenplan/personal
        models:
          - id: glm-5.3
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high
          - id: deepseek-v4.1-flash-1017
            name: deepseek-flash
            input:
              - text
              - image

# 企业默认模型
- id: agent-default-model
  config:
    provider: deepseek
    model: deepseek-flash
- id: eterna-panel
  name: '@eterna/panel'
  disabled: true
- id: runtime-flag
  name: '@deepseek-ai/plugin-x'
`

test('用户新增的 LLM provider 跨升级重渲染保留(事故回归)', () => {
  const { text, preserved } = transplantPatch(TEMPLATE, OLD_RENDERED)
  assert.deepEqual(preserved, ['baidu-token-plan'])
  assert.match(text, /^ {6}baidu-token-plan:$/m)
  assert.match(text, /baseURL: https:\/\/qianfan\.baidubce\.com\/anthropic\/tokenplan\/personal/)
  // 三个模型与推理档整块搬过去(不是只剩路由名)
  assert.match(text, /- id: deepseek-v4\.1-flash-1017/)
  assert.match(text, /^ {14}off: null$/m)
  // 插入位置:providers 映射内,模板 provider 之后、下一个根行之前
  const providerAt = text.indexOf('baidu-token-plan:')
  const nextRowAt = text.indexOf('- id: agent-default-model')
  assert.ok(providerAt > 0 && providerAt < nextRowAt, 'provider 必须落在 llm-pi-ai 行内')
  assert.ok(text.indexOf('opendesign:') < providerAt, '模板 provider 仍在,新块追加在其后')
})

test('模板既有 provider 不被旧渲染覆盖(产品目录升级照常落地)', () => {
  const old = `${OLD_RENDERED.replace('- id: deepseek-flash', '- id: deepseek-flash\n            name: 用户改过的名字')}`
  const { text } = transplantPatch(TEMPLATE, old)
  assert.doesNotMatch(text, /用户改过的名字/, '模板路由以模板为准(既有口径)')
  assert.match(text, /^ {6}deepseek:$/m)
  assert.match(text, /^ {6}baidu-token-plan:$/m)
})

test('历史移植面:disabled 标记与用户追加行保留', () => {
  const { text, edits } = transplantPatch(TEMPLATE, OLD_RENDERED)
  assert.ok(edits >= 1)
  assert.match(text, /- id: eterna-panel\n {2}disabled: true\n {2}name: '@eterna\/panel'/)
  // runtime-flag 两模板都有:按 id 覆写,不产生重复根行
  assert.equal(text.match(/^- id: runtime-flag$/gm)?.length, 1)
})

test('仅存于旧文件、带显式 disabled 的简单标量行仍被追加(半截嵌套不搬)', () => {
  const old = `${TEMPLATE}- id: ops-appended
  name: '@eterna/ops-extra'
  disabled: false
`
  const nested = `${TEMPLATE}- id: broken-block
  config:
    providers:
      x: 1
`
  const simple = transplantPatch(TEMPLATE, old)
  assert.match(simple.text, /- id: ops-appended\n {2}name: '@eterna\/ops-extra'/)
  const skipped = transplantPatch(TEMPLATE, nested)
  assert.doesNotMatch(skipped.text, /broken-block/)
})

test('新模板缺 llm-pi-ai 行:只告警不炸,其余移植照常', () => {
  const template = TEMPLATE.replace(/- id: llm-pi-ai[\s\S]*?\n\n# 企业默认模型/, '# 企业默认模型')
  const { text } = transplantPatch(template, OLD_RENDERED)
  assert.doesNotMatch(text, /baidu-token-plan/)
  assert.match(text, /- id: eterna-panel\n {2}disabled: true\n {2}name: '@eterna\/panel'/)
})

test('幂等:同一模板重复移植产出逐字一致', () => {
  const first = transplantPatch(TEMPLATE, OLD_RENDERED).text
  const second = transplantPatch(TEMPLATE, first).text
  assert.equal(second, first)
})

test('manifest 模式:dsh.profile 块跨升级保留', () => {
  const tpl = JSON.stringify({ name: '@eterna/profile', version: '1.0.0', dsh: { profile: { bundles: ['a'] } } })
  const old = JSON.stringify({ name: '@eterna/profile', dsh: { profile: { bundles: ['a', 'b'] } } })
  const out = JSON.parse(transplantManifest(tpl, old))
  assert.deepEqual(out.dsh, { profile: { bundles: ['a', 'b'] } })
  // 旧文件坏 json:不抛错,保留模板值
  assert.deepEqual(JSON.parse(transplantManifest(tpl, '{oops')).dsh, { profile: { bundles: ['a'] } })
})