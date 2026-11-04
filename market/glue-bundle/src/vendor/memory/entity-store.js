import { DatabaseSync } from "node:sqlite";
const FIELD_LIMITS = {
  subject: 256,
  key: 128,
  content: 65536,
  summary: 200
};
class EntityMemoryStore {
  #db;
  #now;
  #closed = false;
  constructor(dbPath, options = {}) {
    this.#db = new DatabaseSync(dbPath);
    this.#now = options.now ?? (() => Date.now());
    if (dbPath !== ":memory:") this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        valid_at INTEGER NOT NULL,
        invalid_at INTEGER,
        confidence REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_entity_subject_key
        ON memory_entity(subject, key, valid_at);
    `);
  }
  /** 写入一条实体记忆(同键顶替;事务;返回携带 undo 的结果)。 */
  write(input) {
    this.#assertOpen();
    const subject = validateText("subject", input.subject, FIELD_LIMITS.subject);
    const key = validateKey(input.key);
    const content = validateText("content", input.content, FIELD_LIMITS.content);
    const summary = input.summary === void 0 ? null : validateText("summary", input.summary, FIELD_LIMITS.summary);
    const confidence = input.confidence ?? 0.8;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RangeError(`[memory] confidence \u5FC5\u987B\u5728 [0,1],\u5F97\u5230:${confidence}`);
    }
    const now = this.#now();
    const validAt = input.validAt ?? now;
    let record;
    let superseded;
    this.#transaction(() => {
      superseded = this.#liveRowsOf(subject, key);
      const stamp = this.#db.prepare("UPDATE memory_entity SET invalid_at = ?, updated_at = ? WHERE id = ?");
      for (const row of superseded) stamp.run(now, now, row.id);
      const result = this.#db.prepare(`
        INSERT INTO memory_entity (subject, key, content, summary, valid_at, invalid_at, confidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(subject, key, content, summary, validAt, confidence, now, now);
      record = {
        id: Number(result.lastInsertRowid),
        subject,
        key,
        content,
        summary,
        validAt,
        invalidAt: null,
        confidence,
        createdAt: now,
        updatedAt: now
      };
    });
    if (record === void 0 || superseded === void 0) {
      throw new Error("[memory] \u5185\u90E8\u9519\u8BEF:\u4E8B\u52A1\u4F53\u672A\u4EA7\u51FA\u7ED3\u679C");
    }
    const written = record;
    const replaced = superseded;
    let undone = false;
    return {
      record: written,
      superseded: replaced,
      undo: () => {
        if (undone || this.#closed) return;
        undone = true;
        this.#transaction(() => {
          this.#db.prepare("DELETE FROM memory_entity WHERE id = ?").run(written.id);
          const revive = this.#db.prepare("UPDATE memory_entity SET invalid_at = NULL, updated_at = ? WHERE id = ?");
          for (const row of replaced) revive.run(row.updatedAt, row.id);
        });
      }
    };
  }
  /** 读当前 live 行;不存在返回 null。 */
  read(subject, key) {
    this.#assertOpen();
    const row = this.#db.prepare(
      "SELECT * FROM memory_entity WHERE subject = ? AND key = ? AND invalid_at IS NULL ORDER BY valid_at DESC, id DESC LIMIT 1"
    ).get(subject, key);
    return row === void 0 ? null : toRecord(row);
  }
  /** 全历史(live + 已顶替),按 valid_at 升序(审计/审批卡片用)。 */
  readAll(subject, key) {
    this.#assertOpen();
    return this.#db.prepare(
      "SELECT * FROM memory_entity WHERE subject = ? AND key = ? ORDER BY valid_at ASC, id ASC"
    ).all(subject, key).map(toRecord);
  }
  /**
   * 检索 live 行:多词 AND(大小写不敏感,匹配 key/content/summary/subject 拼接),
   * 排序 confidence DESC → updated_at DESC,limit 截断(默认 20)。词项为空返回 []。
   */
  search(query, options = {}) {
    this.#assertOpen();
    const terms = query.trim().toLowerCase().split(/\s+/u).filter((term) => term.length > 0);
    if (terms.length === 0) return [];
    const limit = options.limit ?? 20;
    const rows = options.subject === void 0 ? this.#db.prepare("SELECT * FROM memory_entity WHERE invalid_at IS NULL ORDER BY confidence DESC, updated_at DESC").all() : this.#db.prepare(
      "SELECT * FROM memory_entity WHERE invalid_at IS NULL AND subject = ? ORDER BY confidence DESC, updated_at DESC"
    ).all(options.subject);
    const hits = [];
    for (const row of rows) {
      if (hits.length >= limit) break;
      const record = toRecord(row);
      const matchedIn = matchFields(record, terms);
      if (matchedIn !== null) hits.push({ record, matchedIn });
    }
    return hits;
  }
  /** 全部 live 行(注入索引用);可按主体过滤;排序 confidence DESC → updated_at DESC。 */
  listLive(subject) {
    this.#assertOpen();
    const rows = subject === void 0 ? this.#db.prepare("SELECT * FROM memory_entity WHERE invalid_at IS NULL ORDER BY confidence DESC, updated_at DESC").all() : this.#db.prepare(
      "SELECT * FROM memory_entity WHERE invalid_at IS NULL AND subject = ? ORDER BY confidence DESC, updated_at DESC"
    ).all(subject);
    return rows.map(toRecord);
  }
  /**
   * 遗忘 = 应用逆闭包**真删**:物理 DELETE 该 (subject, key) 的全部行(live+历史),
   * 非打标;返回被删行快照(供审计/审批卡片展示「删掉了什么」)。事务内执行。
   */
  forget(subject, key) {
    this.#assertOpen();
    let records = [];
    let changes = 0;
    this.#transaction(() => {
      records = this.readAll(subject, key);
      const result = this.#db.prepare("DELETE FROM memory_entity WHERE subject = ? AND key = ?").run(subject, key);
      changes = Number(result.changes);
    });
    return { forgotten: changes, records };
  }
  /** 全表行数(测试/巡检用;含历史行)。 */
  count() {
    this.#assertOpen();
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM memory_entity").get();
    return toNumber(row?.["n"]);
  }
  /** 关库(会话结束/插件卸载时调用;幂等)。 */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
  /** 事务包装:异常 ROLLBACK 后原样重抛。 */
  #transaction(body) {
    this.#db.exec("BEGIN");
    try {
      body();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #assertOpen() {
    if (this.#closed) throw new Error("[memory] EntityMemoryStore \u5DF2\u5173\u95ED");
  }
  /** live 行直查(write 顶替路径用,按 valid_at 升序稳定遍历)。 */
  #liveRowsOf(subject, key) {
    return this.#db.prepare(
      "SELECT * FROM memory_entity WHERE subject = ? AND key = ? AND invalid_at IS NULL ORDER BY valid_at ASC, id ASC"
    ).all(subject, key).map(toRecord);
  }
}
function matchFields(record, terms) {
  const fields = [
    ["key", record.key],
    ["content", record.content],
    ["summary", record.summary ?? ""],
    ["subject", record.subject]
  ];
  const lowers = fields.map(([, value]) => value.toLowerCase());
  for (const term of terms) {
    if (!lowers.some((lower) => lower.includes(term))) return null;
  }
  const pairs = fields.map(([name], index) => [name, lowers[index] ?? ""]);
  const matched = [];
  for (const [name, lower] of pairs) {
    if (terms.some((term) => lower.includes(term))) matched.push(name);
  }
  return matched;
}
function toRecord(row) {
  return {
    id: toNumber(row["id"]),
    subject: toStringValue(row["subject"]),
    key: toStringValue(row["key"]),
    content: toStringValue(row["content"]),
    summary: row["summary"] === null ? null : toStringValue(row["summary"]),
    validAt: toNumber(row["valid_at"]),
    invalidAt: row["invalid_at"] === null ? null : toNumber(row["invalid_at"]),
    confidence: toNumber(row["confidence"]),
    createdAt: toNumber(row["created_at"]),
    updatedAt: toNumber(row["updated_at"])
  };
}
function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new TypeError(`[memory] sqlite \u6570\u503C\u5217\u51FA\u73B0\u975E\u6570\u503C:${String(value)}`);
}
function toStringValue(value) {
  if (typeof value === "string") return value;
  throw new TypeError(`[memory] sqlite \u6587\u672C\u5217\u51FA\u73B0\u975E\u6587\u672C:${String(value)}`);
}
function validateText(field, value, max) {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RangeError(`[memory] ${field} \u4E0D\u80FD\u4E3A\u7A7A`);
  if (trimmed.length > max) throw new RangeError(`[memory] ${field} \u8D85\u957F(${trimmed.length} > ${max})`);
  return trimmed;
}
function validateKey(value) {
  const key = validateText("key", value, FIELD_LIMITS.key);
  if (/\s/u.test(key)) throw new RangeError(`[memory] key \u4E0D\u80FD\u5305\u542B\u7A7A\u767D:${key}`);
  return key;
}
export {
  EntityMemoryStore
};
