/**
 * 参谋模型控件单测(2026-11-25 模型解耦)。
 *
 * 两层:
 * 1. 纯逻辑:目录定位/显示名/档位名(未知路由回退 `provider/model`,未选档不显示)。
 * 2. 结构性护栏:面板确实挂了控件、数据面走 access 两条新端点、中英字典同键、
 *    样式里存在 `modelbar` 标记规则(标记无样式=整条控件退化,见 2026-11-20 缺陷类)。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  effortDisplayName,
  locateModel,
  modelDisplayName,
} from '../src/client/AdviserModelBar.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { AdviserCatalogProvider } from '../src/client/api.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string): string => readFileSync(join(here, '..', relative), 'utf8')

const groups: readonly AdviserCatalogProvider[] = [
  {
    id: 'route-a',
    name: '供应商甲',
    models: [
      {
        id: 'model-a',
        name: '模型甲',
        reasoning: {
          efforts: [{ id: 'low', name: '浅' }, { id: 'high', name: '深' }],
          defaultEffort: 'low',
        },
      },
      { id: 'model-b', name: '模型乙' },
    ],
  },
]

describe('目录定位与显示名', () => {
  it('目录命中用供应商给的 name', () => {
    expect(locateModel(groups, { provider: 'route-a', model: 'model-a' })?.model.name).toBe('模型甲')
    expect(modelDisplayName(groups, { provider: 'route-a', model: 'model-a' })).toBe('模型甲')
  })

  it('目录未命中(适配器停发/自建路由)回退 provider/model,而不是显示「未知」', () => {
    expect(modelDisplayName(groups, { provider: 'route-x', model: 'm-1' })).toBe('route-x/m-1')
    expect(modelDisplayName(groups, { provider: 'route-a', model: 'gone' })).toBe('route-a/gone')
  })

  it('选择未知(null)=undefined(调用方显示「读取中/未知」);目录未加载时先显示 provider/model', () => {
    expect(modelDisplayName(groups, null)).toBeUndefined()
    expect(modelDisplayName(null, { provider: 'route-a', model: 'model-a' })).toBe('route-a/model-a')
  })

  it('档位:未显式选档不显示(跟随适配器默认);显式用目录名,目录无名回退 id', () => {
    expect(effortDisplayName(groups, { provider: 'route-a', model: 'model-a' })).toBeUndefined()
    expect(effortDisplayName(groups, { provider: 'route-a', model: 'model-a', reasoningEffort: 'high' })).toBe('深')
    expect(effortDisplayName(groups, { provider: 'route-x', model: 'm', reasoningEffort: 'odd' })).toBe('odd')
  })
})

describe('接线护栏', () => {
  it('参谋 tab 对话区上沿挂模型控件(主会话/参谋 id 都传)', () => {
    expect(read('src/client/AdviserPanel.tsx'))
      .toContain('<AdviserModelBar t={t} parent={value.parentSessionId} child={value.childSessionId} />')
  })

  it('数据面:读 model/read、写 model(access 守卫路由)', () => {
    const api = read('src/client/api.ts')
    expect(api).toContain("'/access/api/adviser/model/read'")
    expect(api).toContain("'/access/api/adviser/model'")
    // 模型目录走宿主既有 typert 端点,不自建目录路由。
    expect(api).toContain("'/api/session/modelCatalog'")
  })

  it('中英字典的 model.* 键集合一致(缺键=一端显示原始 key)', () => {
    const keys = (dict: Record<string, string>): string[] => Object.keys(dict).filter(key => key.startsWith('model.')).sort()
    expect(keys(zh)).toEqual(keys(en))
    expect(keys(zh).length).toBeGreaterThanOrEqual(10)
  })

  it('modelbar 标记有对应样式规则(标记无样式=控件裸奔,2026-11-20 缺陷类)', () => {
    const styles = read('src/client/styles.ts')
    expect(styles).toContain("[data-eterna-adviser='modelbar']")
    expect(styles).toContain('.et-adviser-model-chip')
    expect(styles).toContain('.et-adviser-model-popover')
  })

  it('样式只用 --et-* 令牌,无字面色值(AGENTS.md 铁律 2)', () => {
    const styles = read('src/client/styles.ts')
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
    expect(styles).not.toMatch(/\brgba?\(/u)
  })
})
