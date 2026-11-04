import { DatabaseSync } from "node:sqlite";
import { fuseByRRF } from "./rrf.ts";
const VISIBILITY_SQL = `status <> 'deprecated'
  AND (superseded_by IS NULL OR superseded_by = '')
  AND NOT (trust = 'agent_drafted' AND review <> 'reviewed')`;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  doc_id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  source_uri TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  status TEXT NOT NULL,
  trust TEXT NOT NULL,
  review TEXT NOT NULL,
  superseded_by TEXT,
  origin TEXT NOT NULL,
  created TEXT,
  updated TEXT,
  valid_at TEXT,
  last_verified TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(doc_id UNINDEXED, title, body, tokenize='trigram');
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  patch TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  note TEXT
);
`;
class WikiIndexer {
  db;
  disposed = false;
  constructor(options) {
    this.db = new DatabaseSync(options?.dbPath ?? ":memory:");
    this.db.exec(SCHEMA);
  }
  /** 配逆:关闭连接(不再执行任何查询)。 */
  dispose() {
    if (this.disposed) return;
    this.db.close();
    this.disposed = true;
  }
  /** 幂等 upsert 一页(pages + fts 双表)。 */
  upsertPage(page) {
    this.assertLive();
    this.db.prepare(
      `INSERT INTO pages (doc_id, path, source_uri, title, snippet, body, tags, status, trust, review, superseded_by, origin, created, updated, valid_at, last_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(doc_id) DO UPDATE SET
         path=excluded.path, source_uri=excluded.source_uri, title=excluded.title, snippet=excluded.snippet,
         body=excluded.body, tags=excluded.tags, status=excluded.status, trust=excluded.trust, review=excluded.review,
         superseded_by=excluded.superseded_by, origin=excluded.origin, created=excluded.created, updated=excluded.updated,
         valid_at=excluded.valid_at, last_verified=excluded.last_verified`
    ).run(
      page.doc_id,
      page.path,
      page.source_uri,
      page.title,
      page.snippet,
      page.body,
      JSON.stringify(page.tags),
      page.status,
      page.trust,
      page.review,
      page.superseded_by ?? null,
      page.origin,
      page.created ?? null,
      page.updated ?? null,
      page.valid_at ?? null,
      page.last_verified ?? null
    );
    this.db.prepare("DELETE FROM pages_fts WHERE doc_id = ?").run(page.doc_id);
    this.db.prepare("INSERT INTO pages_fts (doc_id, title, body) VALUES (?, ?, ?)").run(page.doc_id, page.title, page.body);
  }
  /** 删除一页(双表)。 */
  removePage(docId) {
    this.assertLive();
    this.db.prepare("DELETE FROM pages WHERE doc_id = ?").run(docId);
    this.db.prepare("DELETE FROM pages_fts WHERE doc_id = ?").run(docId);
  }
  /** 已索引页数(含不可见页——物理留档)。 */
  countPages() {
    this.assertLive();
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM pages").get();
    return Number(row?.n ?? 0);
  }
  /** 按 doc_id 取页面行(含被过滤的页:read/deprecate 需要定位文件)。 */
  getPageRow(docId) {
    this.assertLive();
    const row = this.db.prepare(
      `SELECT doc_id, path, source_uri, title, snippet, status, trust, review, superseded_by, origin, created, updated, valid_at
       FROM pages WHERE doc_id = ?`
    ).get(docId);
    return row === void 0 ? void 0 : toPageRow(row);
  }
  /**
   * 关键词检索:FTS5 trigram MATCH(≥3 字符 token)+ 短词 LIKE 回退,RRF 融合;
   * SQL 层已套可见性硬过滤。
   */
  searchKeyword(query, topK) {
    this.assertLive();
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const ftsTokens = tokens.filter((t) => t.length >= 3);
    const shortTokens = tokens.filter((t) => t.length < 3);
    const lists = [];
    if (ftsTokens.length > 0) {
      const fts = this.ftsSearch(ftsTokens, topK * 2);
      if (fts.length > 0) lists.push(fts);
    }
    if (shortTokens.length > 0) {
      const like = this.likeSearch(shortTokens, topK * 2);
      if (like.length > 0) lists.push(like);
    }
    return fuseByRRF(lists, { topK });
  }
  /** 全库扫描式 LIKE(短词回退);token 间 OR 保召回(与 FTS 路一致),排序按出现序弱分。 */
  likeSearch(tokens, limit) {
    const clauses = [];
    const params = [];
    for (const token of tokens) {
      const pattern = `%${escapeLike(token)}%`;
      clauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
    const rows = this.db.prepare(
      `SELECT doc_id FROM pages WHERE ${VISIBILITY_SQL} AND (${clauses.join(" OR ")}) LIMIT ?`
    ).all(...params, limit);
    return rows.map((row, index) => {
      const meta = this.loadHitMeta(String(row.doc_id ?? ""));
      return meta === void 0 ? void 0 : {
        ...meta,
        score: 1 / (index + 2)
        // 弱序分:LIKE 无相关性度量,按出现顺序递减
      };
    }).filter((h) => h !== void 0);
  }
  /** FTS5 MATCH(BM25 负值越优);token 以 OR 组合保召回,排序交给 bm25。 */
  ftsSearch(tokens, limit) {
    const matchExpr = tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
    const rows = this.db.prepare(
      `SELECT doc_id, bm25(pages_fts) AS rank FROM pages_fts
       WHERE pages_fts MATCH ? AND doc_id IN (SELECT doc_id FROM pages WHERE ${VISIBILITY_SQL})
       ORDER BY rank LIMIT ?`
    ).all(matchExpr, limit);
    return rows.map((row) => {
      const docId = String(row.doc_id ?? "");
      const meta = this.loadHitMeta(docId);
      if (meta === void 0) return void 0;
      const rank = Number(row.rank ?? 0);
      return { ...meta, score: 1 / (1 + Math.abs(rank)) };
    }).filter((h) => h !== void 0);
  }
  /** 组装命中元数据(可见性二次校验,防御 SQL 拼写漂移)。 */
  loadHitMeta(docId) {
    const row = this.getPageRow(docId);
    if (row === void 0) return void 0;
    const provenance = rowToProvenance(row);
    if (provenance.status === "deprecated" || provenance.superseded_by !== void 0 && provenance.superseded_by !== "" || provenance.trust === "agent_drafted" && provenance.review !== "reviewed") return void 0;
    return {
      ref: { doc_id: row.doc_id, source_uri: row.source_uri, backend: "wiki-local" },
      title: row.title,
      snippet: row.snippet,
      score: 0,
      provenance
    };
  }
  // ---- 提案存储(propose 流转状态机;见 wiki.ts) ----
  insertProposal(proposal) {
    this.assertLive();
    this.db.prepare(
      "INSERT INTO proposals (id, state, patch, created_at, decided_at, decided_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      proposal.id,
      proposal.state,
      JSON.stringify(proposal.patch),
      proposal.created_at,
      proposal.decided_at ?? null,
      proposal.decided_by ?? null,
      proposal.note ?? null
    );
  }
  updateProposalState(id, state, decidedAt, decidedBy, note) {
    this.assertLive();
    this.db.prepare("UPDATE proposals SET state = ?, decided_at = ?, decided_by = ?, note = ? WHERE id = ?").run(state, decidedAt, decidedBy ?? null, note ?? null, id);
  }
  /** 配逆:删除提案记录(propose/discardProposal 的 undo)。 */
  deleteProposal(id) {
    this.assertLive();
    this.db.prepare("DELETE FROM proposals WHERE id = ?").run(id);
  }
  getProposal(id) {
    this.assertLive();
    const row = this.db.prepare("SELECT id, state, patch, created_at, decided_at, decided_by, note FROM proposals WHERE id = ?").get(id);
    if (row === void 0) return void 0;
    return {
      id: String(row.id ?? ""),
      state: String(row.state ?? "pending"),
      patch: JSON.parse(String(row.patch ?? "{}")),
      created_at: String(row.created_at ?? ""),
      decided_at: row.decided_at === null || row.decided_at === void 0 ? void 0 : String(row.decided_at),
      decided_by: row.decided_by === null || row.decided_by === void 0 ? void 0 : String(row.decided_by),
      note: row.note === null || row.note === void 0 ? void 0 : String(row.note)
    };
  }
  listProposals() {
    this.assertLive();
    const rows = this.db.prepare("SELECT id FROM proposals ORDER BY created_at, id").all();
    return rows.map((row) => this.getProposal(String(row.id ?? ""))).filter((p) => p !== void 0);
  }
  assertLive() {
    if (this.disposed) throw new Error("WikiIndexer \u5DF2 dispose");
  }
}
function tokenize(query) {
  return query.split(/[\s,，。;；:、!！?？/\\|()（）"'「」【】]+/u).map((t) => t.trim()).filter((t) => t.length > 0);
}
function escapeLike(input) {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
function toPageRow(row) {
  const str = (key) => {
    const value = row[key];
    return typeof value === "string" ? value : "";
  };
  const opt = (key) => {
    const value = row[key];
    return typeof value === "string" ? value : void 0;
  };
  return {
    doc_id: str("doc_id"),
    path: str("path"),
    source_uri: str("source_uri"),
    title: str("title"),
    snippet: str("snippet"),
    status: str("status"),
    trust: str("trust"),
    review: str("review"),
    superseded_by: opt("superseded_by"),
    origin: str("origin"),
    created: opt("created"),
    updated: opt("updated"),
    valid_at: opt("valid_at")
  };
}
function rowToProvenance(row) {
  return {
    origin: row.origin,
    created: row.created,
    updated: row.updated,
    valid_at: row.valid_at,
    status: row.status,
    superseded_by: row.superseded_by,
    trust: row.trust,
    review: row.review
  };
}
export {
  WikiIndexer,
  rowToProvenance
};
