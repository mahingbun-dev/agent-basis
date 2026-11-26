/**
 * 右侧「插件」页贡献(plugins.tab slot):「恒灵插件」管理页签(admin)。
 * - 原生插件页同构呈现:分组(治理基座/恒灵功能插件)+行卡(图标块+名称+描述+开关)
 * - 开关=停用/启用(重启生效;enable 同时撤销删除恢复挂载);删除=两击确认
 *   (永久卸载语义——removed 清单,entrypoint 裁剪 patch 行)
 * - 红线(治理/审计/出网/门禁)锁定展示:checked+disabled 开关,不可停用
 * - 数据走 /access/api/plugins(服务端 admin 强制);仅 admin 注册本页签
 * 注:@eterna 插件为 profile 挂载,不进上游 Installed 清单,故用页签承载。
 * T6(2026-11-18):新增「共享工具」分区——转内置产物的进程内装载面
 * (/api/my-plugins/shared/*),启停即时生效(区别于上方 @eterna 插件的重启语义)。
 */
import { useCallback, useEffect, useState } from 'react'
import type { PluginTabProps, PluginTabUpdate } from '@deepseek-ai/dsh-client-ui-plugin-manager'
import { api, type PluginRowView } from './api.ts'
import { ArmedDelete } from './confirm-button.tsx'
import { PLUGIN_META } from './plugin-meta.tsx'
import { postRpc } from './rpc.ts'
import { Switch } from './switch.tsx'

interface SharedPlugin {
  pluginId: string
  dir: string
  enabled: boolean
  mounted: boolean
  tools: string[]
  mountError?: string
}

/** 共享工具分区(转内置产物;admin 启停,进程内装载即刻生效)。 */
function SharedSection(): React.JSX.Element | null {
  const [items, setItems] = useState<SharedPlugin[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [note, setNote] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const r = await postRpc('/api/my-plugins/shared/list')
    if (r.ok && typeof r.value === 'object' && r.value !== null) setItems((r.value as { items: SharedPlugin[] }).items)
    setLoaded(true)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const toggle = useCallback((item: SharedPlugin): void => {
    const path = item.enabled ? '/api/my-plugins/shared/disable' : '/api/my-plugins/shared/enable'
    setBusyId(item.pluginId)
    setNote('')
    postRpc(path, { request: { pluginId: item.pluginId } })
      .then(r => {
        if (!r.ok) setNote(r.error?.message ?? '操作失败')
        else void refresh()
      })
      .catch((error: unknown) => { setNote(error instanceof Error ? error.message : '操作失败') })
      .finally(() => { setBusyId('') })
  }, [refresh])

  if (!loaded || items.length === 0) return null
  return <section className="ea-group" data-eterna-shared-plugins>
    <div className="ea-group-head">
      <h3 className="ea-group-title">共享工具(转内置)</h3>
      <span className="ea-group-hint">全员可用;启停即刻生效,无需重启</span>
    </div>
    <ul className="ea-cards">
      {items.map(item => <li className="ea-pcard ea-act" key={item.pluginId}>
        <div className="ea-phead">
          <div className="ea-pmain">
            <div className="ea-ptitle-row">
              <span className="ea-ptitle">{item.pluginId}</span>
              <span className="ea-pill neutral">{item.enabled ? (item.mounted ? `已装载 ${item.tools.length} 个工具` : '已启用(未装载)') : '已停用'}</span>
            </div>
            <span className="ea-pdesc">{item.mountError !== undefined && item.mountError !== '' ? `装载失败:${item.mountError}` : item.tools.length > 0 ? item.tools.join(', ') : item.dir}</span>
          </div>
          <div className="ea-pend">
            <Switch checked={item.enabled} disabled={busyId === item.pluginId}
              label={`${item.pluginId}(共享工具,${item.enabled ? '已启用' : '已停用'})`}
              onToggle={() => { toggle(item) }} />
          </div>
        </div>
      </li>)}
    </ul>
    {note !== '' && <p className="ea-err" role="alert" aria-live="polite">{note}</p>}
  </section>
}

/** 开关(原生 Switch 同构):button[role=switch]+圆点,形态由 CSS 承担。 */

/** 编译期断言(rc.5):页签 props 必须携带必填 `update(target: PluginTabUpdate)`。
 *  契约影子若漏项/走形,此处先红;仅存在于类型层,不进 bundle。 */
export type ManageTabCarriesUpdate =
  Parameters<typeof ManageTab>[0]['update'] extends (target: PluginTabUpdate) => void ? true : false

/** 恒灵插件管理页签(Plugins 页 tabs,原生插件页卡片形态)。
 *  owner props 按 rc.5 `PluginTabProps` 全量声明(install/update/openPackage 必填;
 *  `update` 为 rc.5 新增项)。本页签自绘 @eterna 插件停用/删除链路,不消费页面的
 *  安装与 git 更新能力,owner props 只作契约对齐位。
 *
 *  T6.2(2026-11-24):本页签对全体角色注册,`readOnly` 由角色注入(非 admin=true)
 *  ——开关禁用、删除按钮不渲染、顶部文案改只读。服务端写端点仍 admin 强制,
 *  本参数只是体验层(不让非 admin 点了才报错)。 */
export function ManageTab(props: PluginTabProps & { readonly readOnly?: boolean | undefined }): React.JSX.Element {
  const readOnly = props.readOnly === true
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
    const switchTitle = readOnly
      ? '只读:仅管理员可启停内置插件'
      : plugin.removed
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
          {!plugin.removed && !readOnly ? <ArmedDelete busy={busy} onConfirm={() => { remove(plugin) }} /> : null}
          <Switch checked={!plugin.disabled} disabled={busy || readOnly} title={switchTitle}
            label={`${title}（${plugin.removed ? '已标记删除' : plugin.disabled ? '已停用' : '启用中'}）`}
            onToggle={() => { toggle(plugin) }} />
        </div>
      </div>
    </li>
  }

  const redline = plugins.filter(p => p.redLine)
  const toggleable = plugins.filter(p => !p.redLine)

  return <div data-eterna-access-root>
    <p className="ea-lead">{readOnly
      ? '恒灵 L1 插件清单(只读)。启停与卸载仅管理员可操作。治理/审计/出网/门禁为红线，任何人不可停用。'
      : '恒灵 L1 插件的停用与卸载（admin）。停用可随时恢复；删除为永久卸载，重启容器生效，重新打开开关可撤销。治理/审计/出网/门禁为红线，不可停用。'}</p>
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
      <SharedSection />
    </div>}
    <p className={note.ok ? 'ea-ok' : 'ea-err'} aria-live="polite" style={{ marginTop: 10 }}>{note.text}</p>
  </div>
}
