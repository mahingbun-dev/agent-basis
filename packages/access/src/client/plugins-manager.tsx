/**
 * 右侧「插件」页贡献(plugins.tab slot):「恒灵插件」管理页签(admin)。
 * - @eterna 插件卡片:停用/启用(重启生效)+ 删除(两击确认,永久卸载语义——
 *   removed 清单,entrypoint 裁剪 patch 行;enable 撤销删除恢复挂载)
 * - 红线(治理/审计/出网/门禁)锁定展示,不可停用
 * - 数据走 /access/api/plugins(服务端 admin 强制);仅 admin 注册本页签
 * 注:@eterna 插件为 profile 挂载,不进上游 Installed 清单,故用页签承载。
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type PluginRowView } from './api.ts'

/** 行内两击删除按钮(禁用原生对话框——内嵌 webview 卡死实测)。 */
function ArmedDelete(props: { onConfirm: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return <button className="ea-btn ghost ea-danger-text" style={{ padding: '5px 14px' }}
      onClick={() => { setArmed(true) }}
      onMouseLeave={() => { setArmed(false) }}>删除</button>
  }
  return <button className="ea-btn ghost ea-danger-text" style={{ padding: '5px 14px' }}
    onClick={() => { props.onConfirm() }}>确认删除?</button>
}

/** 恒灵插件管理页签(Plugins 页 tabs)。 */
export function ManageTab(): React.JSX.Element {
  const [plugins, setPlugins] = useState<PluginRowView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    api.plugins().then(value => {
      setPlugins(value.plugins)
      setLoaded(true)
    }).catch(() => { setLoaded(true) })
  }, [])

  const apply = useCallback((next: PluginRowView): void => {
    setPlugins(previous => previous.map(p => p.id === next.id ? next : p))
  }, [])

  const toggle = useCallback((plugin: PluginRowView): void => {
    const action = plugin.disabled ? 'enable' : 'disable'
    api.togglePlugin(plugin.id, action).then((result) => {
      apply({ ...plugin, disabled: result.disabled })
      setNote(`${plugin.label} ${action === 'disable' ? '停用' : '启用'}成功，重启容器后生效`)
    }).catch((error: unknown) => {
      setNote(error instanceof Error ? error.message : '操作失败')
    })
  }, [apply])

  const remove = useCallback((plugin: PluginRowView): void => {
    api.removePlugin(plugin.id).then(() => {
      apply({ ...plugin, disabled: true, removed: true })
      setNote(`${plugin.label} 已标记删除，重启容器后卸载；「启用」可撤销删除恢复挂载`)
    }).catch((error: unknown) => {
      setNote(error instanceof Error ? error.message : '删除失败')
    })
  }, [apply])

  const enable = useCallback((plugin: PluginRowView): void => {
    api.togglePlugin(plugin.id, 'enable').then((result) => {
      apply({ ...plugin, disabled: result.disabled, removed: false })
      setNote(`${plugin.label} 已恢复，重启容器后生效`)
    }).catch((error: unknown) => {
      setNote(error instanceof Error ? error.message : '操作失败')
    })
  }, [apply])

  const cards = plugins.map((plugin) => {
    if (plugin.redLine) {
      return <div className="ea-plug" key={plugin.id}>
        <div className="ea-row between"><span><span className="ea-tag red">红线</span> <b>{plugin.label}</b></span><span className="ea-hint">不可停用</span></div>
        <div className="ea-row between"><span className="ea-hint">{plugin.id}</span></div>
      </div>
    }
    const state = plugin.removed ? '已删除(重启后卸载)' : plugin.disabled ? '已停用(重启生效)' : '启用中'
    const main = plugin.removed
      ? <button className="ea-btn" style={{ margin: 0, padding: '5px 14px' }} onClick={() => { enable(plugin) }}>恢复</button>
      : <button className="ea-btn ghost" style={{ margin: 0, padding: '5px 14px' }} onClick={() => { toggle(plugin) }}>{plugin.disabled ? '启用' : '停用'}</button>
    const del = plugin.removed
      ? undefined
      : <ArmedDelete onConfirm={() => { remove(plugin) }} />
    return <div className="ea-plug" key={plugin.id}>
      <div className="ea-row between"><b>{plugin.label}</b><span className="ea-hint">{state}</span></div>
      <div className="ea-row between"><span className="ea-hint">{plugin.id}</span><span className="ea-row">{main}{del}</span></div>
    </div>
  })

  return <div data-eterna-access-root>
    <p className="ea-lead">恒灵 L1 插件的停用与卸载（admin）。停用可随时恢复；删除为永久卸载（重启容器生效，「恢复」可撤销）。红线（治理/审计/出网/门禁）不可动。</p>
    {!loaded ? <p className="ea-hint">加载中…</p> : <div>{cards}</div>}
    <p className="ea-hint" style={{ marginTop: 10 }}>{note}</p>
  </div>
}
