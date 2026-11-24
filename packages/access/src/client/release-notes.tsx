/**
 * 版本更新介绍弹窗 —— Client 半边(55 号 §4.3)。
 *
 * 三个面:
 *  1. `ReleaseNotesOverlay` 注册在 `shell.overlay`(原生框级浮层 list/root 槽),
 *     登录后空闲时判定「本版未读」才渲染遮罩;不弹时 return null,不占布局;
 *  2. `ReleaseNotesSection` 注册在 `settings.section`「更新记录」,列出历史版本,
 *     点任意版走同一个弹窗(module 级 review 订阅,不新开壳);
 *  3. 关闭语义:任何关闭(×/Esc/遮罩/以后再看/知道了)都 POST seen(55 号 D2)。
 *
 * 纪律:
 * - 令牌 `--et-*`;图标走 `@eterna/ui/icons`;无字面色值、无手写 SVG 图标;
 * - `shell.overlay` 层可穿透 → 根节点自己 `pointer-events: auto`;
 * - 有待决工具审批时让位(30s 重试,上限 20 次 = 约 10 分钟),不与其抢焦点;
 * - 失败静默:装饰性能力不 console.error、不弹错误条(55 号 §6)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { Translate } from './i18n.ts'

/** 与服务端 `packages/access/src/release-notes.ts` 同形的只读视图(结构重复是有意的:
 *  client bundle 不得 import host 半边——那里 import 了 node:fs)。 */
interface MediaView {
  readonly src: string
  readonly alt: string
  readonly caption?: string
  readonly motion?: string
  readonly notes?: string
}

interface LinkView {
  readonly label: string
  readonly note?: string
  readonly action: string
}

interface SlideView {
  readonly id: string
  readonly kind: 'cover' | 'feature' | 'end'
  readonly kicker?: string
  readonly title: string
  readonly body?: string
  readonly facts?: readonly string[]
  readonly media?: MediaView
  readonly links?: readonly LinkView[]
  readonly footerNote?: string
}

interface ManifestView {
  readonly version: string
  readonly releasedAt: string
  readonly announce: boolean
  readonly theme: string
  readonly summary: string
  readonly highlights: readonly { readonly n: string; readonly text: string }[]
  readonly slides: readonly SlideView[]
}

interface HistoryItem {
  readonly version: string
  readonly releasedAt: string
  readonly theme: string
  readonly announce: boolean
  readonly seen: boolean
}

interface NotesResponse {
  readonly latest: string | null
  readonly version: string | null
  readonly current: ManifestView | null
  readonly seen: boolean
  readonly history: readonly HistoryItem[]
}

export interface ReleaseNotesInjected {
  readonly t: Translate
  /** 收尾页「完整更新记录」的去路;false = 设置壳未就绪,弹窗内降级提示。 */
  readonly openSettingsSection: (id: string) => boolean
}

/** 关闭原因(与服务端 via 白名单逐字一致)。 */
type CloseVia = 'done' | 'skip' | 'close' | 'esc' | 'backdrop'

const NOTES_ENDPOINT = '/access/api/release-notes'
const SEEN_ENDPOINT = '/access/api/release-notes/seen'
/** 审批让位的重试节奏(55 号 §2.3)。 */
const APPROVAL_RETRY_MS = 30_000
const APPROVAL_MAX_RETRIES = 20
/** 设置分区 id(与 index.tsx 的注册逐字一致;收尾页「完整更新记录」跳它)。 */
export const RELEASE_NOTES_SECTION_ID = 'eterna-access.release-notes'

// ── 回看订阅(设置分区 → 浮层)。两条通道并用以求稳:模块级 Set 走同实例直调,
// window 事件兜住「slot 各自加载出一份模块实例」的情形(实测 2026-11-24:仅 Set
// 时设置里点「查看」无反应,浮层可能被宿主按 null 卸载/实例不同)。 ──
const REVIEW_EVENT = 'eterna-release-notes:review'
const reviewListeners = new Set<(version: string) => void>()
function requestReview(version: string): void {
  for (const listener of reviewListeners) listener(version)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REVIEW_EVENT, { detail: version }))
  }
}

function assetUrl(version: string, file: string): string {
  return `${NOTES_ENDPOINT}/asset/${encodeURIComponent(version)}/${encodeURIComponent(file)}`
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function scrollTrackTo(track: HTMLElement | null, left: number): void {
  if (track === null) return
  if (prefersReducedMotion()) {
    track.scrollLeft = left
    return
  }
  if (typeof track.scrollTo === 'function') {
    track.scrollTo({ left, behavior: 'smooth' })
    // 原型实测(2026-11-24):部分内核忽略 {behavior},480ms 后仍在原处则硬落。
    window.setTimeout(() => {
      if (Math.abs(track.scrollLeft - left) > 2) track.scrollLeft = left
    }, 480)
    return
  }
  track.scrollLeft = left
}

/** 弹窗主组件。挂到 `shell.overlay`;props 由 slot 注入份额提供。 */
export function ReleaseNotesOverlay(props: ReleaseNotesInjected): ReactElement | null {
  const { t, openSettingsSection } = props
  const [dialog, setDialog] = useState<{ readonly manifest: ManifestView; readonly review: boolean } | null>(null)
  const [toast, setToast] = useState('')
  const alive = useRef(true)
  const bootstrapped = useRef(false)
  const retries = useRef(0)

  const showToast = useCallback((text: string): void => {
    setToast(text)
    window.setTimeout(() => {
      if (alive.current) setToast((current) => (current === text ? '' : current))
    }, 4000)
  }, [])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const fetchNotes = useCallback(async (version: string | undefined): Promise<NotesResponse | undefined> => {
    try {
      const query = version === undefined ? '' : `?version=${encodeURIComponent(version)}`
      const res = await fetch(`${NOTES_ENDPOINT}${query}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return undefined
      return await res.json() as NotesResponse
    } catch {
      return undefined
    }
  }, [])

  const openFor = useCallback(async (version: string): Promise<void> => {
    const data = await fetchNotes(version)
    if (data?.current == null || !alive.current) return
    setDialog({ manifest: data.current, review: true })
  }, [fetchNotes])

  // 回看入口(设置分区)。
  useEffect(() => {
    const listener = (version: string): void => { void openFor(version) }
    reviewListeners.add(listener)
    const onWindow = (event: Event): void => {
      const version = (event as CustomEvent<string>).detail
      if (typeof version === 'string' && version !== '') listener(version)
    }
    window.addEventListener(REVIEW_EVENT, onWindow)
    return () => {
      reviewListeners.delete(listener)
      window.removeEventListener(REVIEW_EVENT, onWindow)
    }
  }, [openFor])

  // 首次判定:空闲后拉一次;只在页面生命周期内判一次(路由切换不重弹)。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async (): Promise<void> => {
      if (bootstrapped.current) return
      bootstrapped.current = true
      const data = await fetchNotes(undefined)
      if (!alive.current || data?.current == null) return
      if (!data.current.announce || data.seen) return
      // 审批让位:有待决工具审批/提问时先不弹(55 号 §2.3)。
      try {
        const pending = await fetch('/access/api/approvals/tool-pending', { credentials: 'same-origin' })
        if (pending.ok) {
          const body = await pending.json() as { items?: unknown[] }
          if (Array.isArray(body.items) && body.items.length > 0 && retries.current < APPROVAL_MAX_RETRIES) {
            retries.current += 1
            bootstrapped.current = false
            timer = setTimeout(() => { void run() }, APPROVAL_RETRY_MS)
            return
          }
        }
      } catch { /* 审批面不可读 = 当作无待决,按正常弹 */ }
      if (!alive.current) return
      setDialog({ manifest: data.current, review: false })
    }
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback
    if (typeof idle === 'function') {
      idle(() => { void run() }, { timeout: 1500 })
    } else {
      timer = setTimeout(() => { void run() }, 800)
    }
    return () => { if (timer !== undefined) clearTimeout(timer) }
  }, [fetchNotes])

  const close = useCallback((via: CloseVia): void => {
    const manifest = dialog?.manifest
    setDialog(null)
    if (manifest === undefined) return
    // 本地先关(用户意图不可撤回),网络失败下次进入会再弹——可接受(55 号 §6)。
    try {
      void fetch(SEEN_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: manifest.version, via }),
      }).catch(() => {})
    } catch { /* 同步异常同样静默 */ }
    if (via === 'skip' && !dialog?.review) {
      showToast(t('releaseNotes.skipToast'))
    }
  }, [dialog, showToast, t])

  const openSettings = useCallback((): boolean => {
    const ok = openSettingsSection(RELEASE_NOTES_SECTION_ID)
    if (ok) close('done')
    return ok
  }, [close, openSettingsSection])

  if (dialog === null) {
    // 不弹也保留零尺寸根节点:宿主对「返回 null」的浮层条目不保证保持挂载,
    // 而回看订阅依赖组件生命周期(2026-11-24 实测)。空根不占布局、不收指针。
    return <div className="ern-root" data-eterna-release-notes>
      {toast !== '' && <RelNotesToast text={toast} />}
    </div>
  }
  return <div className="ern-root" data-eterna-release-notes>
    <ReleaseNotesDialog
      manifest={dialog.manifest}
      review={dialog.review}
      t={t}
      onClose={close}
      onOpenSettings={openSettings}
    />
    {toast !== '' && <RelNotesToast text={toast} />}
  </div>
}

function RelNotesToast(props: { readonly text: string }): ReactElement {
  return <div className="ern-toast" role="status" aria-live="polite">
    <Icon name="bell" size={16} />
    <span>{props.text}</span>
  </div>
}

interface DialogProps {
  readonly manifest: ManifestView
  readonly review: boolean
  readonly t: Translate
  onClose(via: CloseVia): void
  onOpenSettings(): boolean
}

function ReleaseNotesDialog(props: DialogProps): ReactElement {
  const { manifest, review, t, onClose, onOpenSettings } = props
  const slides = manifest.slides
  const total = slides.length
  const [index, setIndex] = useState(0)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const suppressScroll = useRef(false)
  const heading = useMemo(() => slides[index]?.title ?? manifest.theme, [index, manifest.theme, slides])
  const last = index >= total - 1

  const go = useCallback((next: number): void => {
    const clamped = Math.max(0, Math.min(total - 1, next))
    setIndex(clamped)
    const track = trackRef.current
    if (track === null) return
    suppressScroll.current = true
    scrollTrackTo(track, clamped * track.clientWidth)
    window.setTimeout(() => { suppressScroll.current = false }, 520)
  }, [total])

  // 焦点:进入时记住来源,落在弹窗容器;卸载时归还。**只在挂载/卸载跑**——
  // 翻页不重置焦点(否则点分段条会立刻被拉回容器)。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null
    // 壳层会在浮层挂载后把焦点还给输入框(实测 2026-11-24:activeElement 停在 composer),
    // 下一帧再落一次;卸载时归还来源(壳已重排则不追)。aria-modal 要求焦点真的在弹窗里。
    const frame = requestAnimationFrame(() => { dialogRef.current?.focus() })
    // 焦点护栏:任何落到弹窗外的 focusin 拉回容器,保证 Tab 循环与读屏边界自洽。
    const onFocusIn = (event: FocusEvent): void => {
      const dialog = dialogRef.current
      if (dialog === null) return
      if (event.target instanceof Node && dialog.contains(event.target)) return
      dialog.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('focusin', onFocusIn)
      if (previous !== null && previous.isConnected) previous.focus()
    }
  }, [])

  // 键盘:Esc 关闭、Tab 在弹窗内循环、←/→/Home/End 翻页。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current('esc')
        return
      }
      if (event.key === 'Tab') {
        const dialog = dialogRef.current
        if (dialog === null) return
        const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
        const first = focusable[0]
        const lastEl = focusable[focusable.length - 1]
        if (first === undefined || lastEl === undefined) return
        if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault()
          first.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          lastEl.focus()
        }
        return
      }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1) }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1) }
      else if (event.key === 'Home') { event.preventDefault(); go(0) }
      else if (event.key === 'End') { event.preventDefault(); go(total - 1) }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [go, index, total])

  // 触控板/移动端横滑后同步页码。
  const onScroll = useCallback((): void => {
    const track = trackRef.current
    if (track === null || suppressScroll.current) return
    const width = Math.max(1, track.clientWidth)
    const next = Math.max(0, Math.min(total - 1, Math.round(track.scrollLeft / width)))
    if (next !== index) setIndex(next)
  }, [index, total])

  // 视口尺寸变化:保持当前页(否则 fixed 布局下 scrollLeft 会漂到两页之间)。
  useEffect(() => {
    const onResize = (): void => {
      const track = trackRef.current
      if (track !== null) track.scrollLeft = index * track.clientWidth
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [index])

  return <>
    <div className="ern-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose('backdrop') }}>
      <div
        className="ern-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ern-dialog-title"
        aria-describedby="ern-dialog-lead"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="ern-head">
          <span className="ern-ver tnum">v{manifest.version}</span>
          <span className="ern-sep" aria-hidden="true"></span>
          <span className="ern-date tnum">{manifest.releasedAt}{t('releaseNotes.released')}</span>
          {review && <span className="ern-review">{t('releaseNotes.review')}</span>}
          <span className="ern-spacer"></span>
          <button type="button" className="ern-close" aria-label={t('releaseNotes.close')} onClick={() => onClose('close')}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="ern-track" ref={trackRef} onScroll={onScroll} tabIndex={-1}>
          <h2 id="ern-dialog-title" className="ern-sr">{manifest.theme}</h2>
          <p id="ern-dialog-lead" className="ern-sr">{t('releaseNotes.lead').replace('{count}', String(total))}</p>
          <p className="ern-sr" aria-live="polite">{t('releaseNotes.pageOf').replace('{page}', String(index + 1)).replace('{total}', String(total)).replace('{title}', heading)}</p>
          {slides.map((slide, position) => <Slide key={slide.id} slide={slide} manifest={manifest} position={position} t={t} onOpenSettings={onOpenSettings} onClose={onClose} />)}
        </div>

        <footer className="ern-foot">
          <div className="ern-progress">
            <div className="ern-segs" aria-label={t('releaseNotes.pager')}>
              {slides.map((slide, position) => <button
                key={slide.id}
                type="button"
                className="ern-seg"
                data-state={position === index ? 'current' : position < index ? 'done' : 'todo'}
                aria-current={position === index ? 'true' : undefined}
                aria-label={t('releaseNotes.goPage').replace('{page}', String(position + 1))}
                onClick={() => go(position)}
              />)}
            </div>
            <span className="ern-count tnum">{index + 1} / {total}</span>
          </div>
          <span className="ern-spacer"></span>
          {!last && <button type="button" className="ern-btn ern-btn--ghost" onClick={() => onClose('skip')}>{t('releaseNotes.skip')}</button>}
          <button type="button" className="ern-btn ern-btn--outline" disabled={index === 0} onClick={() => go(index - 1)}>{t('releaseNotes.prev')}</button>
          {last
            ? <button type="button" className="ern-btn ern-btn--primary" onClick={() => onClose('done')}>{t('releaseNotes.done')}</button>
            : <button type="button" className="ern-btn ern-btn--primary" onClick={() => go(index + 1)}>{t('releaseNotes.next')}</button>}
        </footer>
      </div>
    </div>
  </>
}

interface SlideProps {
  readonly slide: SlideView
  readonly manifest: ManifestView
  readonly position: number
  readonly t: Translate
  onOpenSettings(): boolean
  onClose(via: CloseVia): void
}

function Slide(props: SlideProps): ReactElement {
  const { slide, manifest, position, t, onOpenSettings, onClose } = props
  if (slide.kind === 'cover') {
    return <article className="ern-slide ern-slide--cover" aria-label={slide.title}>
      <div className="ern-copy">
        <p className="ern-cover-ver tnum">RELEASE {manifest.version}</p>
        <h3 className="ern-cover-title">{slide.title}</h3>
        <p className="ern-cover-sub">{manifest.summary}</p>
        {manifest.highlights.length > 0 && <div className="ern-chips">
          {manifest.highlights.map((highlight) => <span key={highlight.n} className="ern-chip">
            <span className="ern-chip-n tnum">{highlight.n}</span>{highlight.text}
          </span>)}
        </div>}
      </div>
      <div className="ern-cover-art" aria-hidden="true"><span /><span /><span /></div>
    </article>
  }
  if (slide.kind === 'end') {
    return <article className="ern-slide ern-slide--end" aria-label={slide.title}>
      <span className="ern-end-mark"><Icon name="check" size={28} /></span>
      <h3 className="ern-end-title">{slide.title}</h3>
      {slide.body !== undefined && <p className="ern-end-body">{slide.body}</p>}
      {slide.links !== undefined && slide.links.length > 0 && <div className="ern-end-cards">
        {slide.links.map((link) => <button
          key={link.action}
          type="button"
          className="ern-end-card"
          onClick={() => {
            if (link.action === 'settings.release-notes') onOpenSettings()
            else if (link.action === 'dialog.close') onClose('done')
          }}
        >
          <span className="ern-end-card-title">
            <Icon name={link.action === 'settings.release-notes' ? 'log' : 'check'} size={16} />
            {link.label}
          </span>
          {link.note !== undefined && <span className="ern-end-card-note">{link.note}</span>}
        </button>)}
      </div>}
      {slide.footerNote !== undefined && <p className="ern-end-foot">{slide.footerNote}</p>}
      <p className="ern-sr">{t('releaseNotes.pageOf').replace('{page}', String(position + 1)).replace('{total}', String(manifest.slides.length)).replace('{title}', slide.title)}</p>
    </article>
  }
  const media = slide.media
  return <article className={media === undefined ? 'ern-slide ern-slide--feature ern-slide--text' : 'ern-slide ern-slide--feature'} aria-label={slide.title}>
    {media !== undefined && <figure className="ern-media">
      <MediaFrame media={media} version={manifest.version} eager={position <= 1} t={t} />
      {(media.caption !== undefined || media.notes !== undefined) && <figcaption className="ern-cap">
        {media.caption ?? ''}{media.notes !== undefined ? `${media.caption === undefined ? '' : ' · '}${media.notes}` : ''}
      </figcaption>}
    </figure>}
    <div className="ern-copy">
      {slide.kicker !== undefined && <p className="ern-kicker">{slide.kicker}</p>}
      <h3 className="ern-title">{slide.title}</h3>
      {slide.body !== undefined && <p className="ern-body">{slide.body}</p>}
      {slide.facts !== undefined && slide.facts.length > 0 && <ul className="ern-facts">
        {slide.facts.map((fact) => <li key={fact}><Icon name="check" size={16} /><span>{fact}</span></li>)}
      </ul>}
    </div>
  </article>
}

/** 图片/动图容器:404 就地降级为文字版(不显示破图框,图注仍在)。 */
function MediaFrame(props: { readonly media: MediaView; readonly version: string; readonly eager: boolean; readonly t: Translate }): ReactElement {
  const { media, version, eager, t } = props
  const [broken, setBroken] = useState(false)
  const [motionReady, setMotionReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const motion = media.motion
  const showMotion = motion !== undefined && !prefersReducedMotion()

  if (broken) {
    return <div className="ern-media-fallback" role="img" aria-label={media.alt}>
      <Icon name="eye" size={20} />
      <span>{t('releaseNotes.imageUnavailable')}</span>
    </div>
  }
  return <div className="ern-media-frame">
    <img
      src={assetUrl(version, media.src)}
      alt={media.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setBroken(true)}
      onLoad={() => { if (showMotion) setMotionReady(true) }}
    />
    {showMotion && motionReady && motion !== undefined && <video
      ref={videoRef}
      className="ern-motion"
      src={assetUrl(version, motion)}
      poster={assetUrl(version, media.src)}
      muted
      loop
      playsInline
      autoPlay
      aria-hidden="true"
    />}
  </div>
}

/** 设置分区「更新记录」:全员可见、只读列表;点任一版打开同一个遮罩。
 *  `close` 由设置壳作为 owner share 注入(contract:SettingsSectionOwnerProps)——
 *  先关设置再开遮罩,避免两层模态叠着抢焦点(2026-11-24 验收)。 */
export function ReleaseNotesSection(props: { readonly t: Translate; readonly close?: () => void }): ReactElement {
  const { t, close } = props
  const [data, setData] = useState<NotesResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(NOTES_ENDPOINT, { credentials: 'same-origin', headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.json() as NotesResponse
        if (alive) setData(body)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => { alive = false }
  }, [])

  const history = data?.history ?? []
  return <section className="ea-section" data-eterna-access-root data-eterna-release-notes-section>
    <h3>{t('section.releaseNotes')}</h3>
    <p className="ea-hint">{t('releaseNotes.sectionHint')}</p>
    {failed && <p className="ea-hint">{t('releaseNotes.sectionFailed')}</p>}
    {!failed && history.length === 0 && <p className="ea-hint">{t('releaseNotes.sectionEmpty')}</p>}
    <div className="ea-list">
      {history.map((item) => <div key={item.version} className="ea-row" data-eterna-release-row={item.version}>
        <span className="ern-row-ver tnum">v{item.version}</span>
        <span className="ern-row-theme">{item.theme}</span>
        <span className="ern-row-date tnum">{item.releasedAt}</span>
        {!item.seen && <span className="ern-dot" aria-label={t('releaseNotes.unread')} />}
        <button type="button" className="ea-btn" onClick={() => { close?.(); requestReview(item.version) }}>{t('releaseNotes.view')}</button>
      </div>)}
    </div>
  </section>
}