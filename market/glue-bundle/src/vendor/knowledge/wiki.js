import * as nodeFs from "node:fs";
import { dirname } from "node:path";
import { WikiIndexer } from "./indexer.ts";
import { isVisibleInSearch } from "./visibility.ts";
import { formatCitation, parseWikiPage, serializeWikiPage } from "./frontmatter.ts";
import { fuseByRRF } from "./rrf.ts";
import { KnowledgeNotFoundError, KnowledgeStateError } from "./errors.ts";
function createNodeFsAdapter(fs) {
  return {
    listMarkdownFiles(root) {
      const out = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const child = `${dir}/${entry.name}`;
          if (entry.isDirectory()) walk(child);
          else if (entry.isFile() && entry.name.endsWith(".md")) out.push(child.slice(root.length + 1));
        }
      };
      walk(root);
      return Promise.resolve(out);
    },
    readFile: (path) => fs.promises.readFile(path, "utf8"),
    writeFile: (path, content) => fs.promises.writeFile(path, content, "utf8"),
    exists: (path) => Promise.resolve(fs.existsSync(path)),
    ensureDir: async (path) => {
      await fs.promises.mkdir(path, { recursive: true });
    }
  };
}
class WikiLocalBackend {
  id = "wiki-local";
  capabilities = { write: true, deprecate: true, graph: true };
  indexer;
  config;
  fs;
  proposalSeq = 0;
  lastSync;
  constructor(config) {
    this.config = { now: () => /* @__PURE__ */ new Date(), ...config };
    this.fs = config.fs ?? createNodeFsAdapter(nodeFs);
    this.indexer = new WikiIndexer(config.dbPath === void 0 ? {} : { dbPath: config.dbPath });
  }
  /** 配逆:关闭 SQLite 连接(不删 wiki 文件与库文件——留档分发)。 */
  dispose() {
    this.indexer.dispose();
  }
  /**
   * 全量重建索引(effect)。返回 {indexed, skipped};undo = dispose(丢弃派生索引,不动物理文件)。
   * 解析失败的页面跳过并计入 skipped(坏页不静默进库,也不阻断整个 wiki)。
   */
  async reindexAll() {
    const files = await this.fs.listMarkdownFiles(this.config.wikiDir);
    const skipped = [];
    let indexed = 0;
    for (const rel of files) {
      const abs = `${this.config.wikiDir}/${rel}`;
      try {
        const raw = await this.fs.readFile(abs);
        this.upsertParsed(rel, raw);
        indexed++;
      } catch {
        skipped.push(rel);
      }
    }
    this.lastSync = this.config.now().toISOString();
    return { indexed, skipped };
  }
  /** 解析+落一条索引(doc_id 缺省取相对路径去扩展名)。 */
  upsertParsed(rel, raw) {
    const page = parseWikiPage(raw);
    const docId = page.frontmatter.id ?? rel.replace(/\.md$/, "");
    const record = {
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
      origin: page.frontmatter.source ?? `wiki \u9875\u9762 ${rel}`,
      created: page.frontmatter.created,
      updated: page.frontmatter.updated ?? page.frontmatter.last_verified,
      valid_at: page.frontmatter.valid_at ?? page.frontmatter.updated ?? page.frontmatter.last_verified,
      last_verified: page.frontmatter.last_verified
    };
    this.indexer.upsertPage(record);
    return record;
  }
  /**
   * 混合检索:关键词优先(FTS5+LIKE 双路),semantic 提供方在场且模式需要时融合(RRF,关键词列表在前)。
   * 可见性硬过滤已在索引器 SQL 与 loadHitMeta 双层执行;出口处对全部命中再叠加 filters(exclude_stale/trust)。
   */
  async search(query) {
    const topK = query.top_k ?? 8;
    const mode = query.mode ?? "hybrid";
    const hasSemantic = this.config.semantic !== void 0;
    const effectiveMode = mode === "semantic" && !hasSemantic ? "keyword" : mode;
    const keywordHits = effectiveMode === "semantic" ? [] : this.indexer.searchKeyword(query.query, topK).filter((h) => isVisibleInSearch(h.provenance, query.filters));
    if (effectiveMode !== "hybrid" || !hasSemantic) return keywordHits.slice(0, topK);
    const semanticRaw = await this.config.semantic.search(query.query, topK);
    const semanticHits = [];
    for (const item of semanticRaw) {
      const row = this.indexer.getPageRow(item.doc_id);
      if (row === void 0) continue;
      const hit = this.rowToHit(row, item.score);
      if (hit !== void 0 && isVisibleInSearch(hit.provenance, query.filters)) semanticHits.push(hit);
    }
    return fuseByRRF([keywordHits, semanticHits], { topK });
  }
  rowToHit(row, score) {
    const provenance = {
      origin: row.origin,
      created: row.created,
      updated: row.updated,
      valid_at: row.valid_at,
      status: row.status,
      superseded_by: row.superseded_by,
      trust: row.trust,
      review: row.review
    };
    if (!isVisibleInSearch(provenance)) return void 0;
    return {
      ref: { doc_id: row.doc_id, source_uri: row.source_uri, backend: "wiki-local" },
      title: row.title,
      snippet: row.snippet,
      score,
      provenance
    };
  }
  /** 读文档(read 不受检索可见性限制——显式 ref 可读归档页,引用处自带警示)。 */
  async read(ref) {
    const row = this.indexer.getPageRow(ref.doc_id);
    if (row === void 0) throw new KnowledgeNotFoundError(`wiki-local \u65E0\u6B64\u6587\u6863:${ref.doc_id}`);
    return this.readByPath(row.path, row.doc_id, row.source_uri);
  }
  async readByPath(path, docId, sourceUri) {
    const raw = await this.fs.readFile(path);
    const page = parseWikiPage(raw);
    const doc = {
      ref: { doc_id: docId, source_uri: sourceUri, backend: "wiki-local" },
      title: page.frontmatter.title,
      tags: page.frontmatter.tags,
      body: page.body,
      wikilinks: page.wikilinks,
      changelog: page.changelog,
      provenance: {
        origin: page.frontmatter.source ?? `wiki \u9875\u9762 ${path}`,
        created: page.frontmatter.created,
        updated: page.frontmatter.updated ?? page.frontmatter.last_verified,
        valid_at: page.frontmatter.valid_at,
        status: page.frontmatter.status,
        superseded_by: page.frontmatter.superseded_by,
        trust: page.frontmatter.trust,
        review: page.frontmatter.review
      },
      citation: ""
    };
    return { ...doc, citation: formatCitation({ ...doc, snippet: page.snippet, score: 0 }) };
  }
  /**
   * 统一写入口:只产生提案(pending),不直接生效、不建索引。
   * 即使门禁配置缺失,fail-closed 默认门禁也会拒绝——未过审内容不会出现在检索结果里。
   */
  propose(patch) {
    if (patch.title.trim().length === 0) throw new KnowledgeStateError("\u63D0\u6848 title \u4E0D\u80FD\u4E3A\u7A7A");
    if (patch.body.trim().length === 0) throw new KnowledgeStateError("\u63D0\u6848 body \u4E0D\u80FD\u4E3A\u7A7A");
    this.proposalSeq++;
    const id = `prop-${this.config.now().toISOString()}-${this.proposalSeq}`;
    this.indexer.insertProposal({ id, state: "pending", patch, created_at: this.config.now().toISOString() });
    return Promise.resolve(id);
  }
  listProposals() {
    return this.indexer.listProposals();
  }
  getProposal(id) {
    return this.indexer.getProposal(id);
  }
  /** 配逆:撤销未决提案(对 propose 的 undo)。已决提案不可撤(状态机单向,审计友好)。 */
  discardProposal(id) {
    const proposal = this.indexer.getProposal(id);
    if (proposal === void 0) throw new KnowledgeNotFoundError(`\u65E0\u6B64\u63D0\u6848:${id}`);
    if (proposal.state !== "pending") throw new KnowledgeStateError(`\u63D0\u6848 ${id} \u5DF2 ${proposal.state},\u4E0D\u53EF\u64A4\u9500`);
    this.indexer.deleteProposal(id);
    return Promise.resolve();
  }
  /**
   * 提案流转:经 governance 门禁钩子裁决。
   * approve → 落盘发布(trust=decision.trust??'verified',review='reviewed')→ 建索引 → 此刻起可检索;
   * reject / 门禁抛错(fail-closed)→ 提案拒绝,内容永不落盘。
   * 返回 ReviewOutcome,undo() 为发布效应的配逆(删文件+删索引+提案回 pending,真删)。
   */
  async reviewProposal(id, reviewer = "governance-gate") {
    const proposal = this.indexer.getProposal(id);
    if (proposal === void 0) throw new KnowledgeNotFoundError(`\u65E0\u6B64\u63D0\u6848:${id}`);
    if (proposal.state !== "pending") throw new KnowledgeStateError(`\u63D0\u6848 ${id} \u5DF2 ${proposal.state},\u4E0D\u53EF\u91CD\u590D\u8BC4\u5BA1`);
    let decision;
    try {
      const gate = this.config.gate ?? defaultDenyGate;
      decision = await gate(proposal);
    } catch (cause) {
      decision = { kind: "reject", reason: `\u95E8\u7981\u6267\u884C\u5931\u8D25(fail-closed):${String(cause)}` };
    }
    const decidedAt = this.config.now().toISOString();
    if (decision.kind === "reject") {
      const rejected = {
        ...proposal,
        state: "rejected",
        decided_at: decidedAt,
        decided_by: reviewer,
        note: decision.reason
      };
      this.indexer.updateProposalState(id, "rejected", decidedAt, reviewer, decision.reason);
      return {
        proposal: rejected,
        undo: () => {
          this.reopenProposal(id, proposal);
          return Promise.resolve();
        }
      };
    }
    return this.publishProposal(proposal, decision.trust ?? "verified", reviewer, decidedAt);
  }
  /** 发布:写文件 + changelog 追加 + 建索引(此刻起 trust≥verified/reviewed,可检索)。 */
  async publishProposal(proposal, trust, reviewer, decidedAt) {
    const publishedTrust = trust === "agent_drafted" ? "verified" : trust;
    const date = decidedAt.slice(0, 10);
    const slug = slugify(proposal.patch.title);
    const rel = proposal.patch.path ?? `agent-drafts/${slug}.md`;
    const abs = `${this.config.wikiDir}/${rel}`;
    const note = proposal.patch.changelog_note ?? `\u7ECF governance \u95E8\u7981\u53D1\u5E03(\u8BC4\u5BA1:${reviewer})`;
    const page = {
      frontmatter: {
        // patch 显式指定 doc_id 时写进 frontmatter.id;缺省走"doc_id=相对路径"的 wiki 惯例
        ...proposal.patch.doc_id !== void 0 ? { id: proposal.patch.doc_id } : {},
        title: proposal.patch.title,
        tags: proposal.patch.tags ?? [],
        status: "active",
        trust: publishedTrust,
        review: "reviewed",
        source: proposal.patch.origin ?? "agent \u64B0\u5199,\u7ECF\u95E8\u7981\u53D1\u5E03",
        created: date,
        updated: date,
        valid_at: date
      },
      body: `${proposal.patch.body.trimEnd()}

## Changelog

- ${date}: ${note}
`,
      wikilinks: [],
      changelog: [{ date, note }],
      snippet: ""
    };
    const serialized = serializeWikiPage(page);
    await this.fs.ensureDir(dirname(abs));
    await this.fs.writeFile(abs, serialized);
    const record = this.upsertParsed(rel, serialized);
    const approved = {
      ...proposal,
      state: "approved",
      decided_at: decidedAt,
      decided_by: reviewer,
      note: `\u5DF2\u53D1\u5E03\u4E3A ${record.doc_id}`
    };
    this.indexer.updateProposalState(proposal.id, "approved", decidedAt, reviewer, approved.note);
    this.lastSync = decidedAt;
    return {
      proposal: approved,
      published: { doc_id: record.doc_id, source_uri: record.source_uri, backend: "wiki-local" },
      undo: async () => {
        this.indexer.removePage(record.doc_id);
        if (await this.fs.exists(abs)) await this.deleteFileViaAdapter(abs);
        this.reopenProposal(proposal.id, proposal);
      }
    };
  }
  /** 删除文件(fs adapter 无 delete 契约时回退 node:fs unlink;测试可注入内存实现)。 */
  async deleteFileViaAdapter(abs) {
    const fsMod = this.fs.deleteFile;
    if (fsMod !== void 0) {
      await fsMod(abs);
      return;
    }
    const nodeFs2 = await import("node:fs");
    await nodeFs2.promises.unlink(abs);
  }
  reopenProposal(id, snapshot) {
    this.indexer.deleteProposal(id);
    this.indexer.insertProposal({ ...snapshot, state: "pending", decided_at: void 0, decided_by: void 0, note: void 0 });
  }
  /**
   * 废弃/取代(deprecate):frontmatter 重写(status=deprecated + superseded_by + changelog)+ 重建该页索引。
   * 物理留档(文件不删、不移动),检索出口逻辑不可见。返回 undo(恢复原文)。
   */
  async deprecate(docId, reason, supersededBy) {
    const row = this.indexer.getPageRow(docId);
    if (row === void 0) throw new KnowledgeNotFoundError(`wiki-local \u65E0\u6B64\u6587\u6863:${docId}`);
    const raw = await this.fs.readFile(row.path);
    const page = parseWikiPage(raw);
    if (page.frontmatter.status === "deprecated") throw new KnowledgeStateError(`${docId} \u5DF2\u662F deprecated`);
    const date = this.config.now().toISOString().slice(0, 10);
    const successor = supersededBy ?? "";
    if (successor.length === 0 && page.frontmatter.superseded_by === void 0) {
      throw new KnowledgeStateError("deprecate \u5FC5\u987B\u63D0\u4F9B superseded_by(\u5E9F\u5F03\u5FC5\u586B)");
    }
    const deprecated = serializeWikiPage({
      ...page,
      frontmatter: { ...page.frontmatter, status: "deprecated", superseded_by: successor || page.frontmatter.superseded_by },
      body: `${page.body.trimEnd()}

## Changelog

- ${date}: \u6807\u8BB0\u5E9F\u5F03(${reason})${successor ? `,\u7531 ${successor} \u53D6\u4EE3` : ""}
`
    });
    await this.fs.writeFile(row.path, deprecated);
    const rel = row.path.slice(this.config.wikiDir.length + 1);
    this.upsertParsed(rel, deprecated);
    return {
      undo: async () => {
        await this.fs.writeFile(row.path, raw);
        this.upsertParsed(rel, raw);
      }
    };
  }
  health() {
    return Promise.resolve({ ok: true, doc_count: this.indexer.countPages(), last_sync: this.lastSync });
  }
}
const defaultDenyGate = () => ({ kind: "reject", reason: "\u672A\u914D\u7F6E governance \u95E8\u7981(fail-closed \u9ED8\u8BA4\u62D2\u7EDD)" });
function slugify(title) {
  const slug = title.trim().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return slug.length > 0 ? slug : "untitled";
}
export {
  WikiLocalBackend,
  createNodeFsAdapter,
  slugify
};
