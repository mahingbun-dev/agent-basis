/**
 * T2 防漂移 fixture(2026-11-11):上游 typert 全量 mode:'stream' 方法表 −
 * 策略动作清单(GLOBAL∪SESSION∪WORKSPACE)=∅。上游新增流端点而清单未跟时本测试红。
 * 直接读 node_modules 上游包(typert.remote-client.js),锁版 0.2.2-rc.1。
 *
 * 2026-11-18 增资源 kind 防漂移(「右侧文件面板 no-allow」根因):名称覆盖之外,
 * 逐方法按网关 callResources 的解析口径(gateway access.ts:lookup 参数读
 * lookups.register 的 resource kind;session-controller resources.register('session',
 * {resolve}) 读 sessionId 参数/首对象参数)推导资源 kind,断言动作归位清单一致——
 * 上游把某流方法改资源逐会话而清单仍授 global 时本组断言红(mux.ts 头注证据链)。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { GLOBAL_EVENT_ACTIONS, SESSION_EVENT_ACTIONS, SESSION_STREAM_ACTIONS, GLOBAL_STREAM_ACTIONS, GLOBAL_UNARY_ACTIONS, SESSION_UNARY_ACTIONS, WORKSPACE_STREAM_ACTIONS, WORKSPACE_UNARY_ACTIONS, bindingsFor } from '../src/mux.ts'

function findPnpmRoot(): string {
  let dir = new URL('..', import.meta.url).pathname
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', '.pnpm')
    if (existsSync(candidate)) return candidate
    dir = join(dir, '..')
  }
  throw new Error('找不到 node_modules/.pnpm(上游包根)')
}

/** 上游全部 mode:'stream' 的 Remote 方法('ns/method')。 */
function upstreamStreamMethods(): string[] {
  return [...upstreamStreamSegments().keys()].sort()
}

/** 上游流方法描述符原文(action → 自方法键起至下一方法键止的文本段)。
 *  同包多 peer 变体取首个即可:锁版同源,描述符一致。 */
function upstreamStreamSegments(): Map<string, string> {
  const root = findPnpmRoot()
  const segments = new Map<string, string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // .pnpm 目录名形如 @deepseek-ai+dsh-api-session-controller@0.2.2-rc.1_<peerhash>
    const nameMatch = /^@deepseek-ai\+([a-z-]+)@/.exec(entry.name)
    const pkgName = nameMatch?.[1]
    if (pkgName === undefined || !pkgName.startsWith('dsh-api-')) continue
    const file = join(root, entry.name, 'node_modules', '@deepseek-ai', pkgName, 'lib', 'typert.remote-client.js')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    const keyRe = /'([a-zA-Z]+\/[a-zA-Z]+)': \{/
    let current: string | undefined
    let start = -1
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === undefined) continue
      const keyMatch = keyRe.exec(line)
      const key = keyMatch?.[1]
      if (key !== undefined) {
        if (current !== undefined && /mode: 'stream'/.test(lines.slice(start, i).join('\n'))) {
          if (!segments.has(current)) segments.set(current, lines.slice(start, i).join('\n'))
        }
        current = key
        start = i
      }
    }
    if (current !== undefined && /mode: 'stream'/.test(lines.slice(start).join('\n'))) {
      if (!segments.has(current)) segments.set(current, lines.slice(start).join('\n'))
    }
  }
  return segments
}

/** 上游 lookup → resource kind 注册表(全部 @deepseek-ai+dsh-* 包 lib/index.js 的
 *  lookups.register;agent/session 在 core 包,workspaceFileScope 在 workspace-files)。 */
function upstreamLookupKinds(): Map<string, string> {
  const root = findPnpmRoot()
  const kinds = new Map<string, string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith('@deepseek-ai+dsh-')) continue
    const pkgName = /^@deepseek-ai\+(dsh-[a-z-]+)@/.exec(entry.name)?.[1]
    if (pkgName === undefined) continue
    const file = join(root, entry.name, 'node_modules', '@deepseek-ai', pkgName, 'lib', 'index.js')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const pattern = /lookups\.register\("(\w+)", \{[^}]*?resource: "(\w+)"/g
    for (const match of text.matchAll(pattern)) {
      const kind = match[1]
      const resource = match[2]
      if (kind !== undefined && resource !== undefined && !kinds.has(kind)) kinds.set(kind, resource)
    }
  }
  return kinds
}

/** 资源 kind 注册面:session 解析器在位(resources.register('session', { resolve:))
 *  与字段直读 kinds(resources.register('workspace', { field: 'workspaceId' }))。 */
function upstreamResourceRegistrations(): { sessionResolver: boolean; fieldKinds: Map<string, string> } {
  const root = findPnpmRoot()
  let sessionResolver = false
  const fieldKinds = new Map<string, string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith('@deepseek-ai+dsh-')) continue
    const pkgName = /^@deepseek-ai\+(dsh-[a-z-]+)@/.exec(entry.name)?.[1]
    if (pkgName === undefined) continue
    const file = join(root, entry.name, 'node_modules', '@deepseek-ai', pkgName, 'lib', 'index.js')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    if (/resources\.register\("session", \{ resolve: /.test(text)) sessionResolver = true
    const pattern = /resources\.register\("(\w+)", \{ field: "(\w+)"/g
    for (const match of text.matchAll(pattern)) {
      const kind = match[1]
      const field = match[2]
      if (kind !== undefined && field !== undefined && !fieldKinds.has(field)) fieldKinds.set(field, kind)
    }
  }
  return { sessionResolver, fieldKinds }
}

/** 从描述符文本段提取首个 json 对象参数的顶层 properties/required(字符串感知的花
 *  括号配平;解析失败返回 undefined——分类退化为 global,fail-closed 同 23 §3.1)。 */
function firstObjectParamShape(segment: string): { properties: string[]; required: string[] } | undefined {
  const schemaStart = segment.indexOf('jsonSchema: {"type":"object"')
  if (schemaStart < 0) return undefined
  const braceStart = segment.indexOf('{', schemaStart)
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = braceStart; i < segment.length; i++) {
    const ch = segment[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const schema = JSON.parse(segment.slice(braceStart, i + 1)) as {
            properties?: Record<string, unknown>
            required?: string[]
          }
          return { properties: Object.keys(schema.properties ?? {}), required: schema.required ?? [] }
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/** 资源 kind 推导(镜像网关 callResources 解析优先级,mux.ts 头注证据链):
 *  'session' | 'global' | 'dual'(global 与 session 双授——sessionId 可选或
 *  无载荷 open 均按 global 判定、带会话判定按 session)。 */
type StreamResourceKind = 'session' | 'global' | 'dual'

function classifyStreamResourceKind(
  action: string,
  segment: string,
  lookupKinds: Map<string, string>,
  registrations: { sessionResolver: boolean; fieldKinds: Map<string, string> },
): StreamResourceKind {
  // 1. lookup 参数:kind 取注册表(agent/workspaceFileScope → session)
  const lookup = /lookup: '(\w+)'/.exec(segment)?.[1]
  if (lookup !== undefined) {
    const kind = lookupKinds.get(lookup)
    if (kind === 'session') return 'session'
    if (kind !== undefined) throw new Error(`${action}: lookup ${lookup} 的 resource kind '${kind}' 未纳入分类(新 kind 需扩展 classifyStreamResourceKind)`)
  }
  // 2. 字段直读注册(如 workspace → workspaceId)
  for (const [field, kind] of registrations.fieldKinds) {
    if (new RegExp(`(name|wire): '${field}'`).test(segment)) {
      if (kind === 'workspace') return kind as StreamResourceKind
      throw new Error(`${action}: 字段注册 kind '${kind}' 未纳入分类`)
    }
  }
  // 3. sessionId 具名参数(session 解析器按参数名直读,terminal/retain)
  if (/(name|wire): 'sessionId'/.test(segment)) return registrations.sessionResolver ? 'session' : 'global'
  // 4. 首对象参数顶层 sessionId/address 字段(job/list required → session;
  //    job/follow 可选 → dual;session/follow·observeEvent 走 address → session)
  const shape = firstObjectParamShape(segment)
  if (shape !== undefined && shape.properties.includes('sessionId')) {
    return shape.required.includes('sessionId') ? 'session' : 'dual'
  }
  if (shape !== undefined && shape.properties.includes('address')) return 'session'
  return 'global'
}

/** 上游全部 mode:'emit' 的宿主广播事件('ns/method';typert.host.js 的声明 JSON)。 */
function upstreamEmitEvents(): Set<string> {
  const root = findPnpmRoot()
  const events = new Set<string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const nameMatch = /^@deepseek-ai\+([a-z-]+)@/.exec(entry.name)
    const pkgName = nameMatch?.[1]
    if (pkgName === undefined || !pkgName.startsWith('dsh-api-')) continue
    const file = join(root, entry.name, 'node_modules', '@deepseek-ai', pkgName, 'lib', 'typert.host.js')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const pattern = /"name": "([\w-]+\/[\w-]+)",\s*"mode": "emit"/g
    for (const match of text.matchAll(pattern)) events.add(match[1] ?? '')
  }
  return events
}

/** 上游转发清单(API_REMOTE_FORWARDED_EVENTS,构建时并入 dsh-api-remotes lib/index.js)。 */
function forwardedEventsManifest(): string {
  const root = findPnpmRoot()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const nameMatch = /^@deepseek-ai\+dsh-api-remotes@/.exec(entry.name)
    if (nameMatch === null) continue
    return readFileSync(join(root, entry.name, 'node_modules', '@deepseek-ai', 'dsh-api-remotes', 'lib', 'index.js'), 'utf8')
  }
  throw new Error('找不到 dsh-api-remotes 转发清单')
}

const COVERED = new Set([...GLOBAL_STREAM_ACTIONS, ...SESSION_STREAM_ACTIONS, ...WORKSPACE_STREAM_ACTIONS])

/** 上游 decide 链豁免动作(principal.kind==='owner' 或 action===FOLLOW_ACTION 恒 allow,
 *  dsh-api-remote-access lib/index.js:224)——不需策略绑定。 */
const UPSTREAM_EXEMPT = new Set(['remoteAccess/follow'])

describe('T2 防漂移:上游流方法表全覆盖', () => {
  const upstream = upstreamStreamMethods()

  it('上游流方法清单可解析且含已知核心集(空表=解析失效,测试本身失去意义)', () => {
    const core = ['workspace/follow', 'session/follow', 'session/observeState', 'session/control', 'terminal/attach', 'terminal/retain']
    for (const method of core) expect(upstream).toContain(method)
  })

  it('上游全部流方法 ∈ 策略动作清单(差集=∅)', () => {
    const missing = upstream.filter(m => !COVERED.has(m) && !UPSTREAM_EXEMPT.has(m))
    expect(missing).toEqual([])
  })

  it('策略清单无僵尸动作(每个动作都在上游流方法表内——防清单含未注册动作静默放宽)', () => {
    const upstreamSet = new Set(upstream)
    const zombie = [...COVERED].filter(a => !upstreamSet.has(a))
    expect(zombie).toEqual([])
  })

  it('一元读面清单与流方法表互斥(交集=∅——防动作同时在两清单重复放宽)', () => {
    const upstreamSet = new Set(upstream)
    const overlap = [...GLOBAL_UNARY_ACTIONS, ...SESSION_UNARY_ACTIONS, ...WORKSPACE_UNARY_ACTIONS].filter(a => upstreamSet.has(a))
    expect(overlap).toEqual([])
  })

  it('一元读面清单为空时测试失去意义(至少含 settings/describe 与 session/create)', () => {
    expect(GLOBAL_UNARY_ACTIONS.length).toBeGreaterThan(0)
    expect(GLOBAL_UNARY_ACTIONS).toContain('settings/describe')
    expect(GLOBAL_UNARY_ACTIONS).toContain('session/create')
  })

  it('发送/停止/上传的会话级 UI 门在位(2026-11-12「发送按钮消失」回归锚:InputBar.tsx:63-65 以 === false 判定,缺席=按钮不渲染)', () => {
    for (const action of ['session/prompt', 'session/cancel', 'fileUploads/upload']) {
      expect(SESSION_UNARY_ACTIONS).toContain(action)
    }
  })

  it('宿主级 control 快照流 GLOBAL/会话绑定双在位(2026-11-12 回归锚:无载荷 open 按 global 资源判定,只授会话绑定恒 no-allow;内容过滤仍按会话绑定)', () => {
    expect(GLOBAL_STREAM_ACTIONS).toContain('session/control')
    expect(SESSION_STREAM_ACTIONS).toContain('session/control')
  })

  it('上游全部 mode:\'emit\' 事件表可解析且含已知核心集(空表=解析失效,测试本身失去意义)', () => {
    const upstream = upstreamEmitEvents()
    for (const event of ['api-session/status', 'api-session/added', 'api-session/error']) {
      expect(upstream).toContain(event)
    }
  })

  it('事件授权清单均在上游转发清单内且逐会话声明资源(差集=∅——api-remotes remote-events.ts resources={session:id},decide 即租户过滤)', () => {
    const manifest = forwardedEventsManifest()
    for (const action of SESSION_EVENT_ACTIONS) {
      const event = action.replace(/^event:/, '')
      expect(upstreamEmitEvents()).toContain(event)
      // 转发清单里该事件必须带逐会话 resources(不带=按 GLOBAL 判定=跨租户广播,禁授)
      const entryPattern = new RegExp(String.raw`\{\s*event: "${event}",\s*mode: "emit",\s*resources: \{ session: `)
      const entry = entryPattern.exec(manifest)
      expect(entry, `转发清单缺 ${event}`).not.toBeNull()
      expect(entry?.[0]).toContain('resources')
      expect(entry?.[0]).toContain('session:')
    }
  })

  it('全局失效事件授权清单在上游转发清单内且**不带 resources**(不携带资源身份=跨租户面为零)', () => {
    // 2026-11-18「设置页新增供应商保存后配置页看不到」修复的防漂移门:
    // 全局事件只许是本清单列出的失效信号;每个事件在上游 manifest 里的条目
    // 不得声明 resources(声明即按会话/工作区资源判定,只能走 SESSION_EVENT_ACTIONS)。
    const manifest = forwardedEventsManifest()
    expect(GLOBAL_EVENT_ACTIONS.length).toBeGreaterThan(0)
    for (const action of GLOBAL_EVENT_ACTIONS) {
      expect(action.startsWith('event:'), action).toBe(true)
      const event = action.replace(/^event:/, '')
      // 转发清单即宿主广播的权威面(api-remotes lib/index.js 构建时并入);
      // emit 事件名在 typert.host 描述符里只覆盖 dsh-api-* 包,全局事件的服务
      // 侧声明在 dsh-llm/dsh-settings/dsh-credentials,故此处以清单条目为准。
      const entryPattern = new RegExp(String.raw`\{\s*event: "${event}",\s*mode: "emit"\s*\}`)
      expect(entryPattern.test(manifest), `${event} 不在转发清单或声明了 resources——全局绑定禁授`).toBe(true)
    }
  })

  it('全局绑定只含白名单失效事件(其余 event:* 仍恒拒;会话事件仍走会话绑定)', () => {
    // bindingsFor 依赖 store.session/session 仅为类型面;直接构造最小依赖
    // (WS-C 后 Pick 增 getUserById——角色现查,此处桩返回 undefined=fail-closed 按 user 档)
    const minimal = {
      store: { sessionsOfOwner: () => [] as string[], workspacesOfOwner: () => [] as string[], getUserById: () => undefined },
      session: undefined,
    } as never
    const bindings = bindingsFor(minimal, 0)
    const global = bindings.find(b => b.resource.kind === 'global')
    // 差集=∅:任何非白名单事件动作(例如未来新增的会话事件)误入全局绑定即红。
    expect(global?.role.actions.filter(a => a.startsWith('event:')).sort())
      .toEqual([...GLOBAL_EVENT_ACTIONS].sort())
    for (const action of SESSION_EVENT_ACTIONS) expect(GLOBAL_EVENT_ACTIONS).not.toContain(action)
  })

  it('停止按钮生命线事件在位(2026-11-13 回归锚:running 旗标唯此一路,缺席=回合中无停止按钮)', () => {
    expect(SESSION_EVENT_ACTIONS).toContain('event:api-session/status')
  })
})

describe('T2 防漂移:流方法资源 kind 归位(2026-11-18「文件面板 no-allow」根因)', () => {
  const lookupKinds = upstreamLookupKinds()
  const registrations = upstreamResourceRegistrations()

  it('资源 kind 注册面可解析且含已知核心集(空表=解析失效,断言失去意义)', () => {
    expect(lookupKinds.get('agent')).toBe('session')
    expect(lookupKinds.get('workspaceFileScope')).toBe('session')
    expect(registrations.sessionResolver).toBe(true)
    expect(registrations.fieldKinds.get('workspaceId')).toBe('workspace')
  })

  /** 全上游流方法按网关 callResources 口径推导的资源 kind。 */
  function derivedKinds(): Map<string, StreamResourceKind> {
    const kinds = new Map<string, StreamResourceKind>()
    for (const [action, segment] of upstreamStreamSegments()) {
      if (UPSTREAM_EXEMPT.has(action)) continue
      kinds.set(action, classifyStreamResourceKind(action, segment, lookupKinds, registrations))
    }
    return kinds
  }

  it('上游流方法资源 kind 与 2026-11-18 实核表一致(漂移=上游改了资源解析,需人工复核清单归位)', () => {
    const kinds = derivedKinds()
    const expected: Record<string, StreamResourceKind> = {
      // global(open 判定按 global;workspace/follow 另授 workspace 绑定作逐项过滤)
      'workspace/follow': 'global',
      'account/watch': 'global',
      'account/watchExpiry': 'global',
      'session/control': 'global', // 双授会话绑定
      'job/follow': 'dual', // sessionId 可选:无主 job 任何调用者可观察
      // session
      'session/follow': 'session',
      'session/observeState': 'session',
      'session/observeProjections': 'session',
      'session/observeEvent': 'session',
      'terminal/attach': 'session', // lookup agent → session
      'terminal/retain': 'session', // 具名 sessionId 参数
      'workspaceFiles/changes': 'session', // lookup workspaceFileScope → session
      'job/list': 'session', // sessionId required
    }
    // 上游新增流方法(表外)必须显式入表:缺失即红,防止静默按 global 放宽
    const undocumented = [...kinds.keys()].filter(action => !(action in expected))
    expect(undocumented, `新流方法未登记资源 kind 预期: ${undocumented.join(', ')}`).toEqual([])
    for (const [action, kind] of Object.entries(expected)) {
      expect(kinds.get(action), `${action} 资源 kind 漂移`).toBe(kind)
    }
  })

  it('session kind 动作只授会话绑定(∈SESSION;2026-11-18 收编四动作回归锚——global 授予永不命中)', () => {
    const sessionKinds = [...derivedKinds().entries()].filter(([, kind]) => kind === 'session').map(([action]) => action)
    for (const action of sessionKinds) {
      expect(SESSION_STREAM_ACTIONS, `${action} 须授会话绑定`).toContain(action)
      expect(GLOBAL_STREAM_ACTIONS, `${action} 资源逐会话,global 授予永不命中(禁区)`).not.toContain(action)
    }
    // 四个收编动作显式锚定(原 GLOBAL 成员,改授会话绑定)
    for (const action of ['terminal/attach', 'terminal/retain', 'workspaceFiles/changes', 'job/list']) {
      expect(SESSION_STREAM_ACTIONS).toContain(action)
      expect(GLOBAL_STREAM_ACTIONS).not.toContain(action)
    }
  })

  it('global kind 动作授 global 绑定;dual 动作双授(global+session)', () => {
    const kinds = derivedKinds()
    for (const [action, kind] of kinds) {
      if (kind === 'global') expect(GLOBAL_STREAM_ACTIONS, `${action} 须授 global 绑定`).toContain(action)
      if (kind === 'dual') {
        expect(GLOBAL_STREAM_ACTIONS, `${action} 双授缺 global 半`).toContain(action)
        expect(SESSION_STREAM_ACTIONS, `${action} 双授缺 session 半`).toContain(action)
      }
    }
    expect(GLOBAL_STREAM_ACTIONS).toContain('job/follow')
    expect(SESSION_STREAM_ACTIONS).toContain('job/follow')
  })

  it('global 绑定零 session kind 动作(卫生锚:session 资源动作入 global 即跨租户可达)', () => {
    const sessionKinds = new Set([...derivedKinds().entries()].filter(([, kind]) => kind === 'session').map(([action]) => action))
    // 已知双授例外:无载荷 open 按 global 判定的 control
    const allowedInGlobal = new Set(['session/control', 'job/follow'])
    const leaked = GLOBAL_STREAM_ACTIONS.filter(action => sessionKinds.has(action) && !allowedInGlobal.has(action))
    expect(leaked).toEqual([])
  })
})
