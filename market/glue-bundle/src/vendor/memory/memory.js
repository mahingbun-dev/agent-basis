import { EntityMemoryStore } from "./entity-store.ts";
import { buildEntityIndex } from "./index-builder.ts";
import { NotesStore } from "./notes.ts";
import { BuiltinPiiGuard } from "./pii.ts";
const MEMORY_SERVICE_ID = "@basis/memory";
function createMemory(options) {
  const piiGuard = options.pii ?? new BuiltinPiiGuard();
  const entities = new EntityMemoryStore(options.dbPath, ...options.now !== void 0 ? [{ now: options.now }] : []);
  const notes = new NotesStore(options.workspaceDir, piiGuard);
  let disposed = false;
  return {
    id: MEMORY_SERVICE_ID,
    notes,
    entities,
    piiGuard,
    writeEntity(input) {
      piiGuard.assertClean(
        { subject: input.subject, key: input.key, content: input.content, ...input.summary !== void 0 && { summary: input.summary } },
        `entity:${input.subject}/${input.key}`
      );
      return entities.write(input);
    },
    async writeNote(file, content) {
      return notes.write(file, content);
    },
    async appendNote(file, content) {
      return notes.append(file, content);
    },
    readEntity(subject, key) {
      return entities.read(subject, key);
    },
    async search(query, searchOptions = {}) {
      const limit = searchOptions.limit ?? 20;
      const entityHits = entities.search(query, {
        ...searchOptions.subject !== void 0 && { subject: searchOptions.subject },
        limit
      }).map((hit) => ({
        source: `entity:${hit.record.subject}/${hit.record.key}#${hit.record.id}`,
        kind: "entity",
        title: `${hit.record.subject}/${hit.record.key}`,
        summary: hit.record.summary ?? excerpt(hit.record.content)
      }));
      if (entityHits.length >= limit) return entityHits.slice(0, limit);
      if (searchOptions.includeNotes === false) return entityHits;
      const noteHits = (await notes.search(query, { limit: limit - entityHits.length })).map((hit) => ({
        source: `notes:${hit.source}`,
        kind: "note",
        title: hit.source,
        summary: hit.excerpt
      }));
      return [...entityHits, ...noteHits];
    },
    forget(subject, key) {
      return entities.forget(subject, key);
    },
    buildIndex(indexOptions = {}) {
      return buildEntityIndex(entities.listLive(), indexOptions);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entities.close();
    }
  };
}
function excerpt(content) {
  const chars = Array.from(content.trim());
  return chars.length <= 60 ? chars.join("") : `${chars.slice(0, 60).join("")}\u2026`;
}
export {
  MEMORY_SERVICE_ID,
  createMemory
};
