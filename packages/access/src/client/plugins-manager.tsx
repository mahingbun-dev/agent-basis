/**
 * 右侧「插件」页贡献(plugins.tab slot):「恒灵插件」管理页签(admin)。
 * - 原生插件页同构呈现:分组(治理基座/恒灵功能插件)+行卡(图标块+名称+描述+开关)
 * - 开关=停用/启用(重启生效;enable 同时撤销删除恢复挂载);删除=两击确认
 *   (永久卸载语义——removed 清单,entrypoint 裁剪 patch 行)
 * - 红线(治理/审计/出网/门禁)锁定展示:checked+disabled 开关,不可停用
 * - 数据走 /access/api/plugins(服务端 admin 强制);仅 admin 注册本页签
 * 注:@eterna 插件为 profile 挂载,不进上游 Installed 清单,故用页签承载。
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type PluginRowView } from './api.ts'
import { PLUGIN_META } from './plugin-meta.tsx'

/** 开关(原生 Switch 同构):button[role=switch]+圆点,形态由 CSS 承担。 */
function Switch(props: {
  checked: boolean
  disabled: boolean
  label: string
  title?: string
  onToggle: () => void
}): React.JSX.Element {
  return <button type="button" role="switch" aria-checked={props.checked} aria-label={props.label}
    title={props.title} disabled={props.disabled} className="ea-switch"
    onClick={() => { props.onToggle() }}>
    <span className="ea-thumb" />
  </button>
}

/** 行内两击删除按钮(禁用原生对话框——内嵌 webview 卡死实测)。 */
function ArmedDelete(props: { busy: boolean; onConfirm: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  const disarm = (): void => { setArmed(false) }
  if (!armed) {
    return <button className="ea-del" disabled={props.busy}
      onClick={() => { setArmed(true) }}
      onMouseLeave={disarm} onBlur={disarm}>删除</button>
  }
  return <button className="ea-del ea-armed" disabled={props.busy}
    onClick={() => { props.onConfirm() }}
    onMouseLeave={disarm} onBlur={disarm}>确认删除?</button>
}

/** 恒灵插件管理页签(Plugins 页 tabs,原生插件页卡片形态)。 */
export function ManageTab(): React.JSX.Element {
  const [plugins, setPlugins] = useState<PluginRowView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [note, setNote] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })

  useEffect(() => {
    api.plugins().then(value => {
      setPlugins(value.plugins)
      setLoaded(true)
    }).catch(() => { setLoaded(true) })
  }, [])

  const apply = useCallback((next: PluginRowView): void => {
    setPlugins(previous => previous.map(p => p.id === next.id ? next : p))
  }, [])

  const titleOf = useCallback((plugin: PluginRowView): string =>
    PLUGIN_META[plugin.id]?.title ?? plugin.label, [])

  const toggle = useCallback((plugin: PluginRowView): void => {
    const action = plugin.disabled ? 'enable' : 'disable'
    setBusyId(plugin.id)
    api.togglePlugin(plugin.id, action).then((result) => {
      apply({ ...plugin, disabled: result.disabled, removed: action === 'enable' ? false : plugin.removed === true })
      setNote({ ok: true, text: `${titleOf(plugin)} 已${action === 'disable' ? '停用' : '启用'}，重启容器后生效` })
    }).catch((error: unknown) => {
      setNote({ ok: false, text: error instanceof Error ? error.message : '操作失败' })
    }).finally(() => { setBusyId('') })
  }, [apply, titleOf])

  const remove = useCallback((plugin: PluginRowView): void => {
    setBusyId(plugin.id)
    api.removePlugin(plugin.id).then(() => {
      apply({ ...plugin, disabled: true, removed: true })
      setNote({ ok: true, text: `${titleOf(plugin)} 已标记删除，重启容器后卸载；打开开关可撤销删除恢复挂载` })
    }).catch((error: unknown) => {
      setNote({ ok: false, text: error instanceof Error ? error.message : '删除失败' })
    }).finally(() => { setBusyId('') })
  }, [apply, titleOf])

  const row = (plugin: PluginRowView): React.JSX.Element => {
    const meta = PLUGIN_META[plugin.id]
    const title = titleOf(plugin)
    const desc = meta?.desc ?? plugin.id
    const icon = meta === undefined ? null : <meta.Artwork size={36} />
    if (plugin.redLine) {
      return <li className="ea-pcard" key={plugin.id}>
        <div className="ea-phead">
          <span className="ea-picon" aria-hidden="true">{icon}</span>
          <div className="ea-pmain">
            <div className="ea-ptitle-row"><span className="ea-ptitle">{title}</span><span className="ea-pill danger">红线</span></div>
            <span className="ea-pdesc">{desc}</span>
          </div>
          <div className="ea-pend">
            <Switch checked disabled label={`${title}（治理红线，不可停用）`} title="治理红线，不可停用"
              onToggle={() => {}} />
          </div>
        </div>
      </li>
    }
    const busy = busyId === plugin.id
    const pill = plugin.removed
      ? <span className="ea-pill warn">重启后卸载</span>
      : plugin.disabled ? <span className="ea-pill neutral">已停用</span> : null
    const switchTitle = plugin.removed
      ? '已标记删除，打开开关可撤销删除恢复挂载'
      : plugin.disabled ? '启用（重启容器后生效）' : '停用（重启容器后生效）'
    return <li className="ea-pcard ea-act" key={plugin.id}>
      <div className="ea-phead">
        <span className="ea-picon" aria-hidden="true">{icon}</span>
        <div className="ea-pmain">
          <div className="ea-ptitle-row"><span className="ea-ptitle">{title}</span>{pill}</div>
          <span className="ea-pdesc">{desc}</span>
        </div>
        <div className="ea-pend">
          {!plugin.removed ? <ArmedDelete busy={busy} onConfirm={() => { remove(plugin) }} /> : null}
          <Switch checked={!plugin.disabled} disabled={busy} title={switchTitle}
            label={`${title}（${plugin.removed ? '已标记删除' : plugin.disabled ? '已停用' : '启用中'}）`}
            onToggle={() => { toggle(plugin) }} />
        </div>
      </div>
    </li>
  }

  const redline = plugins.filter(p => p.redLine)
  const toggleable = plugins.filter(p => !p.redLine)

  return <div data-eterna-access-root>
    <p className="ea-lead">恒灵 L1 插件的停用与卸载（admin）。停用可随时恢复；删除为永久卸载，重启容器生效，重新打开开关可撤销。治理/审计/出网/门禁为红线，不可停用。</p>
    {!loaded ? <p className="ea-hint">加载中…</p> : <div>
      <section className="ea-group">
        <div className="ea-group-head">
          <h3 className="ea-group-title">治理基座</h3>
          <span className="ea-group-hint">红线插件不可停用</span>
        </div>
        <ul className="ea-cards">{redline.map(row)}</ul>
      </section>
      <section className="ea-group">
        <div className="ea-group-head">
          <h3 className="ea-group-title">恒灵功能插件</h3>
        </div>
        <ul className="ea-cards">{toggleable.map(row)}</ul>
      </section>
    </div>}
    <p className={note.ok ? 'ea-ok' : 'ea-err'} aria-live="polite" style={{ marginTop: 10 }}>{note.text}</p>
  </div>
}
