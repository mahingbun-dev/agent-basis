/**
 * wiki-local 默认后端(设计文档 11 §3):文件优先 markdown wiki + agent 直写 + SQLite 混合检索。
 *
 * 写路径统一为提案制(11 §2.2):propose 只产生提案(pending);reviewProposal 经 governance 门禁钩子裁决——
 * approve → 发布落盘(trust 升 verified/official、review=reviewed)并建索引,此刻起才可被检索;
 * reject / 门禁抛错(fail-closed)→ 提案拒绝,内容永不落盘。未过审内容在任何路径都不会进入 pages/fts 表。
 *
 * Cordis 纪律:
 * - effect 配逆:reindexAll/评审发布/deprecate 均提供 undo(发布 undo=删文件+删索引+提案回 pending,真删);
 * - coeffect 全声明:fs 读写、时钟 now、门禁 gate、向量提供方 semantic 全部构造注入,不碰旁路全局;
 * - provide 可交换:由 KnowledgeService 注册表按唯一 ID 装配(见 service.ts)。
 */
import * as nodeFs from 'node:fs'
import { dirname } from 'node:path'
import { WikiIndexer } from './indexer.ts'
import { isVisibleInSearch } from './visibility.ts'
import { formatCitation, parseWikiPage, serializeWikiPage } from './frontmatter.ts'
import { fuseByRRF } from './rrf.ts'
import { KnowledgeNotFoundError, KnowledgeStateError } from './errors.ts'
import type { PageRecord, PageRow } from './indexer.ts'
import type { WikiPage } from './frontmatter.ts'
import type {
  BackendCapabilities, BackendHealth, DocRef, DocPatch, GovernanceGate, KnowledgeBackend, KnowledgeDoc,
  KnowledgeHit, KnowledgeProposal, SearchQuery, SemanticSearchProvider,
} from './types.ts'

/** 文件系统适配(coeffect 声明式注入;测试与默认实现同构)。 */
export interface WikiFsAdapter {
  /** 列出 wiki 根下全部 .md 相对路径(递归)。 */
  listMarkdownFiles(root: string): Promise<readonly string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** 确保目录存在(recursive mkdir;发布到新命名空间时建目录)。 */
  ensureDir(path: string): Promise<void>
}

export function createNodeFsAdapter(fs: typeof import('node:fs')): WikiFsAdapter {
  return {
    listMarkdownFiles(root): Promise<readonly string[]> {
      const out: string[] = []
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const child = `${dir}/${entry.name}`
          if (entry.isDirectory()) walk(child)
          else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child.slice(root.length + 1))
        }
      }
      walk(root)
      return Promise.resolve(out)
    },
    readFile: (path: string): Promise<string> => fs.promises.readFile(path, 'utf8'),
    writeFile: (path: string, content: string): Promise<void> => fs.promises.writeFile(path, content, 'utf8'),
    exists: (path: string): Promise<boolean> => Promise.resolve(fs.existsSync(path)),
    ensureDir: async (path) => {
      await fs.promises.mkdir(path, { recursive: true })
    },
  }
}

export interface WikiLocalConfig {
  /** wiki 根目录(git 仓库;目录即命名空间)。 */
  readonly wikiDir: string
  /** SQLite 库文件;缺省 :memory:。 */
  readonly dbPath?: string
  /** governance 门禁钩子(缺省 = 一律 reject:无人评审则不发布,fail-closed)。 */
  readonly gate?: GovernanceGate
  /** 向量检索提供方(接口留位;缺省关键词优先单路)。 */
  readonly semantic?: SemanticSearchProvider
  readonly fs?: WikiFsAdapter
  readonly now?: () => Date
}

/** 评审结果:发布产生的文档引用 + 可执行 undo(真删文件 + 删索引 + 提案回 pending)。 */
export interface ReviewOutcome {
  readonly proposal: KnowledgeProposal
  readonly published?: DocRef
  undo(): Promise<void>
}

export class WikiLocalBackend implements KnowledgeBackend {
  readonly id = 'wiki-local'
  readonly capabilities: BackendCapabilities = { write: true, deprecate: true, graph: true }
  private readonly indexer: WikiIndexer
  private readonly config: Required<Pick<WikiLocalConfig, 'wikiDir' | 'now'>> & WikiLocalConfig
  private readonly fs: WikiFsAdapter
  private proposalSeq = 0
  private lastSync: string | undefined

  constructor(config: WikiLocalConfig) {
    this.config = { now: () => new Date(), ...config }
    this.fs = config.fs ?? createNodeFsAdapter(nodeFs)
    this.indexer = new WikiIndexer(config.dbPath === undefined ? {} : { dbPath: config.dbPath })
  }

  /** 配逆:关闭 SQLite 连接(不删 wiki 文件与库文件——留档分发)。 */
  dispose(): void {
    this.indexer.dispose()
  }

  /**
   * 全量重建索引(effect)。返回 {indexed, skipped};undo = dispose(丢弃派生索引,不动物理文件)。
   * 解析失败的页面跳过并计入 skipped(坏页不静默进库,也不阻断整个 wiki)。
   */
  async reindexAll(): Promise<{ indexed: number; skipped: readonly string[] }> {
    const files = await this.fs.listMarkdownFiles(this.config.wikiDir)
    const skipped: string[] = []
    let indexed = 0
    for (const rel of files) {
      const abs = `${this.config.wikiDir}/${rel}`
      try {
        const raw = await this.fs.readFile(abs)
        this.upsertParsed(rel, raw)
        indexed++
      } catch {
        skipped.push(rel)
      }
    }
    this.lastSync = this.config.now().toISOString()
    return { indexed, skipped }
  }

  /** 解析+落一条索引(doc_id 缺省取相对路径去扩展名)。 */
  private upsertParsed(rel: string, raw: string): PageRecord {
    const page = parseWikiPage(raw)
    const docId = page.frontmatter.id ?? rel.replace(/\.md$/, '')
    const record: PageRecord = {
      doc_id: docId,
      path: `${this.config.wikiDir}/${rel}`,
      source_uri: `file://${this.config.wikiDir}/${rel}`,
      title: page.frontmatter.title,
      snippet: page.snippet,
      body: page.body,
      tags: page.frontmatter.tags,
      status: page.frontmatter.status,
      trust: page.frontmatter.trust,
      review: page.frontmatter.review,
      superseded_by: page.frontmatter.superseded_by,
      origin: page.frontmatter.source ?? `wiki 页面 ${rel}`,
      created: page.frontmatter.created,
      updated: page.frontmatter.updated ?? page.frontmatter.last_verified,
      valid_at: page.frontmatter.valid_at ?? page.frontmatter.updated ?? page.frontmatter.last_verified,
      last_verified: page.frontmatter.last_verified,
    }
    this.indexer.upsertPage(record)
    return record
  }

  /**
   * 混合检索:关键词优先(FTS5+LIKE 双路),semantic 提供方在场且模式需要时融合(RRF,关键词列表在前)。
   * 可见性硬过滤已在索引器 SQL 与 loadHitMeta 双层执行;出口处对全部命中再叠加 filters(exclude_stale/trust)。
   */
  async search(query: SearchQuery): Promise<readonly KnowledgeHit[]> {
    const topK = query.top_k ?? 8
    const mode = query.mode ?? 'hybrid'
    const hasSemantic = this.config.semantic !== undefined
    // semantic 模式无向量提供方时降级 keyword(降级不静默失败,返回仍可用)
    const effectiveMode = mode === 'semantic' && !hasSemantic ? 'keyword' : mode
    const keywordHits = effectiveMode === 'semantic'
      ? []
      : this.indexer.searchKeyword(query.query, topK).filter(h => isVisibleInSearch(h.provenance, query.filters))
    if (effectiveMode !== 'hybrid' || !hasSemantic) return keywordHits.slice(0, topK)
    const semanticRaw = await this.config.semantic.search(query.query, topK)
    const semanticHits: KnowledgeHit[] = []
    for (const item of semanticRaw) {
      const row = this.indexer.getPageRow(item.doc_id)
      if (row === undefined) continue
      const hit = this.rowToHit(row, item.score)
      if (hit !== undefined && isVisibleInSearch(hit.provenance, query.filters)) semanticHits.push(hit)
    }
    return fuseByRRF([keywordHits, semanticHits], { topK })
  }

  private rowToHit(row: PageRow, score: number): KnowledgeHit | undefined {
    const provenance = {
      origin: row.origin, created: row.created, updated: row.updated, valid_at: row.valid_at,
      status: row.status as PageRecord['status'], superseded_by: row.superseded_by,
      trust: row.trust as PageRecord['trust'], review: row.review as PageRecord['review'],
    }
    if (!isVisibleInSearch(provenance)) return undefined
    return {
      ref: { doc_id: row.doc_id, source_uri: row.source_uri, backend: 'wiki-local' },
      title: row.title,
      snippet: row.snippet,
      score,
      provenance,
    }
  }

  /** 读文档(read 不受检索可见性限制——显式 ref 可读归档页,引用处自带警示)。 */
  async read(ref: DocRef): Promise<KnowledgeDoc> {
    const row = this.indexer.getPageRow(ref.doc_id)
    if (row === undefined) throw new KnowledgeNotFoundError(`wiki-local 无此文档:${ref.doc_id}`)
    return this.readByPath(row.path, row.doc_id, row.source_uri)
  }

  private async readByPath(path: string, docId: string, sourceUri: string): Promise<KnowledgeDoc> {
    const raw = await this.fs.readFile(path)
    const page = parseWikiPage(raw)
    const doc: KnowledgeDoc = {
      ref: { doc_id: docId, source_uri: sourceUri, backend: 'wiki-local' },
      title: page.frontmatter.title,
      tags: page.frontmatter.tags,
      body: page.body,
      wikilinks: page.wikilinks,
      changelog: page.changelog,
      provenance: {
        origin: page.frontmatter.source ?? `wiki 页面 ${path}`,
        created: page.frontmatter.created,
        updated: page.frontmatter.updated ?? page.frontmatter.last_verified,
        valid_at: page.frontmatter.valid_at,
        status: page.frontmatter.status,
        superseded_by: page.frontmatter.superseded_by,
        trust: page.frontmatter.trust,
        review: page.frontmatter.review,
      },
      citation: '',
    }
    return { ...doc, citation: formatCitation({ ...doc, snippet: page.snippet, score: 0 }) }
  }

  /**
   * 统一写入口:只产生提案(pending),不直接生效、不建索引。
   * 即使门禁配置缺失,fail-closed 默认门禁也会拒绝——未过审内容不会出现在检索结果里。
   */
  propose(patch: DocPatch): Promise<string> {
    if (patch.title.trim().length === 0) throw new KnowledgeStateError('提案 title 不能为空')
    if (patch.body.trim().length === 0) throw new KnowledgeStateError('提案 body 不能为空')
    this.proposalSeq++
    const id = `prop-${this.config.now().toISOString()}-${this.proposalSeq}`
    this.indexer.insertProposal({ id, state: 'pending', patch, created_at: this.config.now().toISOString() })
    return Promise.resolve(id)
  }

  listProposals(): readonly KnowledgeProposal[] {
    return this.indexer.listProposals()
  }

  getProposal(id: string): KnowledgeProposal | undefined {
    return this.indexer.getProposal(id)
  }

  /** 配逆:撤销未决提案(对 propose 的 undo)。已决提案不可撤(状态机单向,审计友好)。 */
  discardProposal(id: string): Promise<void> {
    const proposal = this.indexer.getProposal(id)
    if (proposal === undefined) throw new KnowledgeNotFoundError(`无此提案:${id}`)
    if (proposal.state !== 'pending') throw new KnowledgeStateError(`提案 ${id} 已 ${proposal.state},不可撤销`)
    this.indexer.deleteProposal(id)
    return Promise.resolve()
  }

  /**
   * 提案流转:经 governance 门禁钩子裁决。
   * approve → 落盘发布(trust=decision.trust??'verified',review='reviewed')→ 建索引 → 此刻起可检索;
   * reject / 门禁抛错(fail-closed)→ 提案拒绝,内容永不落盘。
   * 返回 ReviewOutcome,undo() 为发布效应的配逆(删文件+删索引+提案回 pending,真删)。
   */
  async reviewProposal(id: string, reviewer = 'governance-gate'): Promise<ReviewOutcome> {
    const proposal = this.indexer.getProposal(id)
    if (proposal === undefined) throw new KnowledgeNotFoundError(`无此提案:${id}`)
    if (proposal.state !== 'pending') throw new KnowledgeStateError(`提案 ${id} 已 ${proposal.state},不可重复评审`)
    let decision: Awaited<ReturnType<GovernanceGate>>
    try {
      const gate = this.config.gate ?? defaultDenyGate
      decision = await gate(proposal)
    } catch (cause) {
      decision = { kind: 'reject', reason: `门禁执行失败(fail-closed):${String(cause)}` }
    }
    const decidedAt = this.config.now().toISOString()
    if (decision.kind === 'reject') {
      const rejected: KnowledgeProposal = {
        ...proposal, state: 'rejected', decided_at: decidedAt, decided_by: reviewer, note: decision.reason,
      }
      this.indexer.updateProposalState(id, 'rejected', decidedAt, reviewer, decision.reason)
      return {
        proposal: rejected,
        undo: () => {
          this.reopenProposal(id, proposal)
          return Promise.resolve()
        },
      }
    }
    return this.publishProposal(proposal, decision.trust ?? 'verified', reviewer, decidedAt)
  }

  /** 发布:写文件 + changelog 追加 + 建索引(此刻起 trust≥verified/reviewed,可检索)。 */
  private async publishProposal(
    proposal: KnowledgeProposal, trust: 'verified' | 'official' | 'agent_drafted', reviewer: string, decidedAt: string,
  ): Promise<ReviewOutcome> {
    const publishedTrust = trust === 'agent_drafted' ? 'verified' : trust // 过审语义:agent_drafted 必须转正
    const date = decidedAt.slice(0, 10)
    const slug = slugify(proposal.patch.title)
    const rel = proposal.patch.path ?? `agent-drafts/${slug}.md`
    const abs = `${this.config.wikiDir}/${rel}`
    const note = proposal.patch.changelog_note ?? `经 governance 门禁发布(评审:${reviewer})`
    const page: WikiPage = {
      frontmatter: {
        // patch 显式指定 doc_id 时写进 frontmatter.id;缺省走"doc_id=相对路径"的 wiki 惯例
        ...(proposal.patch.doc_id !== undefined ? { id: proposal.patch.doc_id } : {}),
        title: proposal.patch.title,
        tags: proposal.patch.tags ?? [],
        status: 'active',
        trust: publishedTrust,
        review: 'reviewed',
        source: proposal.patch.origin ?? 'agent 撰写,经门禁发布',
        created: date,
        updated: date,
        valid_at: date,
      },
      body: `${proposal.patch.body.trimEnd()}\n\n## Changelog\n\n- ${date}: ${note}\n`,
      wikilinks: [],
      changelog: [{ date, note }],
      snippet: '',
    }
    const serialized = serializeWikiPage(page)
    await this.fs.ensureDir(dirname(abs))
    await this.fs.writeFile(abs, serialized)
    const record = this.upsertParsed(rel, serialized)
    const approved: KnowledgeProposal = {
      ...proposal, state: 'approved', decided_at: decidedAt, decided_by: reviewer, note: `已发布为 ${record.doc_id}`,
    }
    this.indexer.updateProposalState(proposal.id, 'approved', decidedAt, reviewer, approved.note)
    this.lastSync = decidedAt
    return {
      proposal: approved,
      published: { doc_id: record.doc_id, source_uri: record.source_uri, backend: 'wiki-local' },
      undo: async () => {
        // 配逆:删索引 + 真删文件 + 提案回 pending
        this.indexer.removePage(record.doc_id)
        if (await this.fs.exists(abs)) await this.deleteFileViaAdapter(abs)
        this.reopenProposal(proposal.id, proposal)
      },
    }
  }

  /** 删除文件(fs adapter 无 delete 契约时回退 node:fs unlink;测试可注入内存实现)。 */
  private async deleteFileViaAdapter(abs: string): Promise<void> {
    const fsMod = (this.fs as WikiFsAdapter & { deleteFile?: (path: string) => Promise<void> }).deleteFile
    if (fsMod !== undefined) {
      await fsMod(abs)
      return
    }
    const nodeFs = await import('node:fs')
    await nodeFs.promises.unlink(abs)
  }

  private reopenProposal(id: string, snapshot: KnowledgeProposal): void {
    this.indexer.deleteProposal(id)
    this.indexer.insertProposal({ ...snapshot, state: 'pending', decided_at: undefined, decided_by: undefined, note: undefined })
  }

  /**
   * 废弃/取代(deprecate):frontmatter 重写(status=deprecated + superseded_by + changelog)+ 重建该页索引。
   * 物理留档(文件不删、不移动),检索出口逻辑不可见。返回 undo(恢复原文)。
   */
  async deprecate(docId: string, reason: string, supersededBy?: string): Promise<{ undo(): Promise<void> }> {
    const row = this.indexer.getPageRow(docId)
    if (row === undefined) throw new KnowledgeNotFoundError(`wiki-local 无此文档:${docId}`)
    const raw = await this.fs.readFile(row.path)
    const page = parseWikiPage(raw)
    if (page.frontmatter.status === 'deprecated') throw new KnowledgeStateError(`${docId} 已是 deprecated`)
    const date = this.config.now().toISOString().slice(0, 10)
    const successor = supersededBy ?? ''
    if (successor.length === 0 && page.frontmatter.superseded_by === undefined) {
      throw new KnowledgeStateError('deprecate 必须提供 superseded_by(废弃必填)')
    }
    const deprecated = serializeWikiPage({
      ...page,
      frontmatter: { ...page.frontmatter, status: 'deprecated', superseded_by: successor || page.frontmatter.superseded_by },
      body: `${page.body.trimEnd()}\n\n## Changelog\n\n- ${date}: 标记废弃(${reason})${successor ? `,由 ${successor} 取代` : ''}\n`,
    })
    await this.fs.writeFile(row.path, deprecated)
    const rel = row.path.slice(this.config.wikiDir.length + 1)
    this.upsertParsed(rel, deprecated)
    return {
      undo: async () => {
        await this.fs.writeFile(row.path, raw)
        this.upsertParsed(rel, raw)
      },
    }
  }

  health(): Promise<BackendHealth> {
    return Promise.resolve({ ok: true, doc_count: this.indexer.countPages(), last_sync: this.lastSync })
  }
}

/** fail-closed 默认门禁:未配置 gate = 无人评审 = 一律拒绝。 */
const defaultDenyGate: GovernanceGate = () => ({ kind: 'reject', reason: '未配置 governance 门禁(fail-closed 默认拒绝)' })

/** 标题 → doc_id slug(保留 CJK/字母数字,其余折叠为 -)。 */
export function slugify(title: string): string {
  const slug = title.trim().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return slug.length > 0 ? slug : 'untitled'
}
