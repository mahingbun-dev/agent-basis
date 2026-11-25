/**
 * 参谋模型控件(2026-11-25 模型解耦):参谋 tab 对话区上沿的一条 chip + 弹层。
 *
 * ## 为什么不用上游模型选择器
 * 上游 `ui-model-selection` 对 subagent 子会话整体渲染 null(`sessions.subagentAddress`
 * 可用性门),且会话控制器的通用 `selectModel` 对 `origin==='subagent'` 的会话会被
 * `session/agent-busy`(owned by subagent routing)拒绝。参谋的模型切换因此必须走
 * 自己的数据面:access 守卫路由 → `eternaAdviser.model()` → 宿主端口(热 `model.select`
 * / 冷持久化追加 `model/selection`)。
 *
 * ## 语义
 * - 创建时继承主会话当前模型(`agentOptions`),此后**两边各自独立**:这里切换只影响
 *   参谋,主会话的模型菜单也看不见参谋的选择。
 * - 弹层内切换模型 → 立即提交(无「保存」按钮,单动作单提交);带思考档位的模型在
 *   选中行下方展开档位,再点一次落档。
 * - 读面失败不阻塞写面:chip 显示「未知」仍可打开弹层选择模型。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import {
  AdviserApiError,
  fetchModelCatalog,
  readAdviserModel,
  setAdviserModel,
  type AdviserCatalogModel,
  type AdviserCatalogProvider,
  type AdviserModelSelection,
} from './api.ts'

export interface AdviserModelBarProps {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  /** 主会话 id(access 归属校验用)。 */
  readonly parent: string
  /** 参谋会话 id。 */
  readonly child: string
}

interface LocatedModel {
  readonly provider: AdviserCatalogProvider
  readonly model: AdviserCatalogModel
}

/**
 * 在目录里定位一个选择(纯函数,便于单测)。
 * @param groups - 模型目录分组(尚未加载=null)。
 * @param selection - 当前选择(未知=null)。
 * @returns 命中的供应商+模型;目录里没有该路由时 undefined(仍可能是可用模型)。
 */
export function locateModel(
  groups: readonly AdviserCatalogProvider[] | null,
  selection: AdviserModelSelection | null,
): LocatedModel | undefined {
  if (groups === null || selection === null) return undefined
  for (const provider of groups) {
    if (provider.id !== selection.provider) continue
    for (const model of provider.models ?? []) {
      if (model.id === selection.model) return { provider, model }
    }
  }
  return undefined
}

/**
 * 模型显示名:目录命中用供应商给的 name,否则回退 `provider/model`。
 * @returns 显示名;选择未知时 undefined(调用方显示「未知」)。
 */
export function modelDisplayName(
  groups: readonly AdviserCatalogProvider[] | null,
  selection: AdviserModelSelection | null,
): string | undefined {
  if (selection === null) return undefined
  return locateModel(groups, selection)?.model.name ?? `${selection.provider}/${selection.model}`
}

/**
 * 显式档位显示名;未显式选档(跟随适配器默认)返回 undefined。
 * @returns 档位名(目录里没有时回退原始 id)。
 */
export function effortDisplayName(
  groups: readonly AdviserCatalogProvider[] | null,
  selection: AdviserModelSelection | null,
): string | undefined {
  const effort = selection?.reasoningEffort
  if (effort === undefined) return undefined
  const efforts = locateModel(groups, selection)?.model.reasoning?.efforts ?? []
  return efforts.find(row => row.id === effort)?.name ?? effort
}

/**
 * HTTP 失败 → 用户可读中文。
 * 400 用服务面的中文消息(模型不可用等);其余按状态给固定文案(不透传英文原文)。
 */
function errorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof AdviserApiError) {
    if (error.status === 401) return t('model.error.unauthorized')
    if (error.status === 429) return t('model.error.rateLimited')
    if (error.status === 400 && error.message !== '') return error.message
    if (error.status === 503) return t('model.error.unavailable')
  }
  return t('model.error.generic')
}

/** 参谋模型 chip + 弹层(读:GET 语义的 model/read;写:model)。 */
export function AdviserModelBar(props: AdviserModelBarProps): ReactElement {
  const { t, parent, child } = props
  const [groups, setGroups] = useState<readonly AdviserCatalogProvider[] | null>(null)
  const [current, setCurrent] = useState<AdviserModelSelection | null>(null)
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 卸载后不再 setState(切换是异步的,tab 可能先被关掉)。 */
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // 读面:模型目录(全局)+ 参谋当前选择(本会话)。切换参谋时重新读一遍。
  useEffect(() => {
    let alive = true
    setReadState('loading')
    setCurrent(null)
    readAdviserModel(parent, child)
      .then((selection) => {
        if (!alive) return
        setCurrent(selection)
        setReadState('ready')
      })
      .catch(() => { if (alive) setReadState('error') })
    fetchModelCatalog()
      .then((rows) => { if (alive) setGroups(rows) })
      .catch(() => { if (alive) setGroups([]) })
    return () => { alive = false }
  }, [parent, child])

  // 弹层关闭:点外部 / Esc。面板内点行不关(选择动作自己决定关闭时机)。
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root === null || !root.isConnected) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /**
   * 提交一次切换。带档位的模型选中后不关弹层(让用户接着落档);其余即选即收。
   * @param selection - provider/model/可选档位。
   * @param closeAfter - 提交成功是否收起弹层。
   */
  const commit = useCallback((selection: AdviserModelSelection, closeAfter: boolean): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    setAdviserModel(parent, child, selection)
      .then((confirmed) => {
        if (!mounted.current) return
        setCurrent(confirmed)
        setBusy(false)
        if (closeAfter) setOpen(false)
      })
      .catch((failure: unknown) => {
        if (!mounted.current) return
        setBusy(false)
        setError(errorMessage(failure, t))
      })
  }, [busy, parent, child, t])

  const modelName = current === null
    ? readState === 'loading' ? t('model.reading') : t('model.unknown')
    : modelDisplayName(groups, current) ?? t('model.unknown')
  const effortName = effortDisplayName(groups, current)
  const chipText = effortName === undefined ? modelName : `${modelName} · ${effortName}`

  return (
    <div data-eterna-adviser="modelbar" ref={rootRef}>
      <span className="et-adviser-model-label">{t('model.label')}</span>
      <div className="et-adviser-model-anchor">
        <button
          type="button"
          className="et-adviser-model-chip"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${t('model.menuLabel')}:${chipText}`}
          disabled={busy}
          onClick={() => {
            setError(null)
            setOpen(value => !value)
          }}
        >
          <span className="et-adviser-model-chip-text">{chipText}</span>
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {open ? (
        <div className="et-adviser-model-popover" role="menu" aria-label={t('model.menuLabel')}>
          <p className="et-adviser-model-hint">{t('model.hint')}</p>
          {error === null ? null : <p className="et-adviser-model-error" role="alert">{error}</p>}
          {busy ? <p className="et-adviser-model-hint" role="status">{t('model.saving')}</p> : null}
          {groups === null ? (
            <p className="et-adviser-model-hint">{t('model.loadingCatalog')}</p>
          ) : groups.length === 0 ? (
            <p className="et-adviser-model-hint">{t('model.empty')}</p>
          ) : groups.map((group) => (
            <div key={group.id} className="et-adviser-model-group" role="group" aria-label={group.name ?? group.id}>
              <p className="et-adviser-model-group-title">{group.name ?? group.id}</p>
              {(group.models ?? []).map((model) => {
                const active = current !== null && current.provider === group.id && current.model === model.id
                const efforts = model.reasoning?.efforts ?? []
                return (
                  <div key={model.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className="et-adviser-model-row"
                      disabled={busy}
                      onClick={() => commit({ provider: group.id, model: model.id }, efforts.length === 0)}
                    >
                      <span className="et-adviser-model-row-name">{model.name}</span>
                      {active ? <Icon name="check" size={14} /> : null}
                    </button>
                    {active && efforts.length > 0 ? (
                      <div className="et-adviser-model-efforts" role="group" aria-label={t('model.effort')}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={current?.reasoningEffort === undefined}
                          className="et-adviser-model-effort"
                          disabled={busy}
                          onClick={() => commit({ provider: group.id, model: model.id }, true)}
                        >
                          <span>{t('model.effort.default')}</span>
                          {current?.reasoningEffort === undefined ? <Icon name="check" size={12} /> : null}
                        </button>
                        {efforts.map(effort => (
                          <button
                            key={effort.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={current?.reasoningEffort === effort.id}
                            className="et-adviser-model-effort"
                            disabled={busy}
                            onClick={() => commit({
                              provider: group.id, model: model.id, reasoningEffort: effort.id,
                            }, true)}
                          >
                            <span>{effort.name}</span>
                            {current?.reasoningEffort === effort.id ? <Icon name="check" size={12} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
