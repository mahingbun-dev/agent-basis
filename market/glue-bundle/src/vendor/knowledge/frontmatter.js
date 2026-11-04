import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { KnowledgeFormatError, isRecord } from "./errors.js";
const STATUSES = ["active", "stale", "deprecated"];
const TRUSTS = ["official", "verified", "agent_drafted"];
const REVIEWS = ["reviewed", "pending"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const CHANGELOG_NOTE_RE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2}):\s+(.+)$/;
const SNIPPET_MAX = 160;
function expectString(field, value) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string") throw new KnowledgeFormatError(`frontmatter.${field} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32,\u5B9E\u9645 ${typeof value}`);
  return value;
}
function expectDate(field, value) {
  const raw = expectString(field, value);
  if (raw === void 0) return void 0;
  if (!DATE_RE.test(raw)) throw new KnowledgeFormatError(`frontmatter.${field} \u5FC5\u987B\u662F YYYY-MM-DD \u65E5\u671F,\u5B9E\u9645 "${raw}"`);
  return raw;
}
function expectEnum(field, value, allowed) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new KnowledgeFormatError(`frontmatter.${field} \u5FC5\u987B\u662F ${allowed.join("|")} \u4E4B\u4E00,\u5B9E\u9645 ${JSON.stringify(value)}`);
  }
  return value;
}
function extractChangelog(body) {
  const lines = body.split("\n");
  const entries = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+Changelog\s*$/.test(line) || /^##\s+更新记录\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (!inSection) continue;
    const match = CHANGELOG_NOTE_RE.exec(line);
    if (match) entries.push({ date: match[1] ?? "", note: (match[2] ?? "").trim() });
  }
  return entries;
}
function extractWikilinks(body) {
  const out = [];
  for (const match of body.matchAll(WIKILINK_RE)) {
    const target = match[1]?.trim();
    if (target) out.push(target);
  }
  return [...new Set(out)];
}
function extractSnippet(body) {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    return trimmed.length > SNIPPET_MAX ? `${trimmed.slice(0, SNIPPET_MAX)}\u2026` : trimmed;
  }
  return "";
}
function parseWikiPage(raw) {
  if (!raw.startsWith("---\n")) {
    throw new KnowledgeFormatError("\u9875\u9762\u7F3A\u5C11 frontmatter \u5757(\u5FC5\u987B\u4EE5 --- \u5F00\u5934)");
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) throw new KnowledgeFormatError("frontmatter \u5757\u672A\u95ED\u5408(\u7F3A\u5C11\u7ED3\u675F ---)");
  const fmRaw = raw.slice(4, end);
  const body = raw.slice(end + 5).replace(/^\n+/, "");
  let parsed;
  try {
    parsed = parseYaml(fmRaw);
  } catch (cause) {
    throw new KnowledgeFormatError(`frontmatter YAML \u89E3\u6790\u5931\u8D25:${String(cause)}`, { cause });
  }
  if (parsed === void 0 || parsed === null) throw new KnowledgeFormatError("frontmatter \u4E0D\u80FD\u4E3A\u7A7A");
  if (!isRecord(parsed)) throw new KnowledgeFormatError("frontmatter \u5FC5\u987B\u662F YAML \u6620\u5C04");
  const title = expectString("title", parsed.title);
  const h1 = /^#\s+(.+)$/.exec(body.split("\n").find((l) => l.trim().length > 0) ?? "");
  const resolvedTitle = title ?? (h1 ? (h1[1] ?? "").trim() : void 0);
  if (!resolvedTitle) throw new KnowledgeFormatError("\u7F3A\u5C11 title(frontmatter.title \u6216\u6B63\u6587\u4E00\u7EA7\u6807\u9898\u81F3\u5C11\u4E00\u4E2A)");
  const tagsRaw = parsed.tags;
  const tags = [];
  if (tagsRaw !== void 0 && tagsRaw !== null) {
    if (!Array.isArray(tagsRaw)) throw new KnowledgeFormatError("frontmatter.tags \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4");
    for (const tag of tagsRaw) {
      if (typeof tag !== "string") throw new KnowledgeFormatError("frontmatter.tags \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4");
      tags.push(tag);
    }
  }
  const status = expectEnum("status", parsed.status, STATUSES) ?? "active";
  const trust = expectEnum("trust", parsed.trust, TRUSTS) ?? "official";
  const review = expectEnum("review", parsed.review, REVIEWS) ?? (trust === "agent_drafted" ? "pending" : "reviewed");
  const supersededBy = expectString("superseded_by", parsed.superseded_by);
  if (status === "deprecated" && !supersededBy) {
    throw new KnowledgeFormatError("status=deprecated \u7684\u9875\u9762\u5FC5\u987B\u586B superseded_by(\u5E9F\u5F03\u5FC5\u586B)");
  }
  const frontmatter = {
    title: resolvedTitle,
    tags,
    status,
    trust,
    review,
    source: expectString("source", parsed.source),
    created: expectDate("created", parsed.created),
    updated: expectDate("updated", parsed.updated),
    valid_at: expectDate("valid_at", parsed.valid_at),
    last_verified: expectDate("last_verified", parsed.last_verified),
    superseded_by: supersededBy,
    id: expectString("id", parsed.id)
  };
  return { frontmatter, body, wikilinks: extractWikilinks(body), changelog: extractChangelog(body), snippet: extractSnippet(body) };
}
const FM_KEY_ORDER = [
  "id",
  "title",
  "tags",
  "status",
  "trust",
  "review",
  "source",
  "created",
  "updated",
  "valid_at",
  "last_verified",
  "superseded_by"
];
function serializeWikiPage(page) {
  const fm = {};
  const values = {
    id: page.frontmatter.id,
    title: page.frontmatter.title,
    tags: page.frontmatter.tags.length > 0 ? [...page.frontmatter.tags] : void 0,
    status: page.frontmatter.status,
    trust: page.frontmatter.trust,
    review: page.frontmatter.review,
    source: page.frontmatter.source,
    created: page.frontmatter.created,
    updated: page.frontmatter.updated,
    valid_at: page.frontmatter.valid_at,
    last_verified: page.frontmatter.last_verified,
    superseded_by: page.frontmatter.superseded_by
  };
  for (const key of FM_KEY_ORDER) {
    const value = values[key];
    if (value !== void 0) fm[key] = value;
  }
  return `---
${stringifyYaml(fm).trimEnd()}
---

${page.body.trimEnd()}
`;
}
function formatCitation(hit) {
  const updated = hit.provenance.updated ?? hit.provenance.valid_at ?? "\u672A\u77E5\u65E5\u671F";
  const status = hit.provenance.status === "deprecated" ? "\u5DF2\u5E9F\u5F03" : hit.provenance.status === "stale" ? "\u5F85\u6838\u9A8C" : "\u751F\u6548\u4E2D";
  const supersede = hit.provenance.superseded_by ? `,\u5DF2\u88AB ${hit.provenance.superseded_by} \u53D6\u4EE3` : "";
  return `[\u300A${hit.title}\u300B](${hit.ref.source_uri})(\u66F4\u65B0\u4E8E ${updated};${status}${supersede})`;
}
export {
  extractChangelog,
  extractSnippet,
  extractWikilinks,
  formatCitation,
  parseWikiPage,
  serializeWikiPage
};
