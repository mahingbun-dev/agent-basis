import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
const EXCERPT_MAX_CHARS = 160;
class NotesStore {
  #root;
  #guard;
  constructor(rootDir, guard) {
    this.#root = resolve(rootDir);
    this.#guard = guard;
  }
  /** 根目录(绝对路径)。 */
  get rootDir() {
    return this.#root;
  }
  /** 读一个记忆文件;不存在返回 null。路径不合法/不在根内抛错。 */
  async read(file) {
    const abs = this.#resolveChecked(file);
    try {
      return await readFile(abs, { encoding: "utf8" });
    } catch (error) {
      if (isNodeNoSuchFileError(error)) return null;
      throw error;
    }
  }
  /**
   * 写一个记忆文件(整文件覆盖)。写入前强制 PII assertClean(fail-closed)。
   * 返回携带应用逆闭包的结果。
   */
  async write(file, content) {
    const abs = this.#resolveChecked(file);
    this.#guard.assertClean(content, file);
    const prior = await this.read(file);
    const createdDirs = await ensureDir(dirname(abs), this.#root);
    await writeFile(abs, content, { encoding: "utf8" });
    let undone = false;
    return {
      file: toRelative(file),
      existed: prior !== null,
      async undo() {
        if (undone) return;
        undone = true;
        if (prior === null) {
          await rm(abs, { force: true });
          await pruneEmptyDirs(createdDirs);
        } else {
          await writeFile(abs, prior, { encoding: "utf8" });
        }
      }
    };
  }
  /**
   * 追加到记忆文件(文件不存在则创建;以单个换行衔接,结尾补换行)。
   * 写入前强制 PII assertClean(fail-closed)。undo 恢复写入前全文/删除新建文件。
   */
  async append(file, content) {
    const base = await this.read(file) ?? "";
    const glue = base.length === 0 || base.endsWith("\n") ? "" : "\n";
    return this.write(file, `${base}${glue}${content}
`);
  }
  /**
   * 全文检索:多词 AND(大小写不敏感),按行命中,返回带出处(file#Lline)。
   * 遍历根目录下全部 *.md(含 NOTES.md 与 notes/ 子树),词项为空返回 []。
   */
  async search(query, options = {}) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const limit = options.limit ?? 20;
    const files = await this.list();
    const hits = [];
    for (const file of files) {
      if (hits.length >= limit) break;
      const text = await this.read(file);
      if (text === null) continue;
      const lines = text.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (hits.length >= limit) break;
        const line = lines[index];
        if (line === void 0) continue;
        const lower = line.toLowerCase();
        if (terms.every((term) => lower.includes(term))) {
          hits.push({
            source: `${file}#L${index + 1}`,
            file,
            line: index + 1,
            excerpt: excerptOf(line)
          });
        }
      }
    }
    return hits;
  }
  /** 列出根目录内全部记忆文件(相对路径,按路径排序;仅 *.md)。 */
  async list() {
    const out = [];
    await collectMarkdown(this.#root, this.#root, out);
    out.sort();
    return out;
  }
  /**
   * 校验并解析相对路径:拒绝绝对路径/~、出根路径、非 .md 后缀;
   * 返回绝对路径。允许 `./` 前缀与 `notes/` 子目录。
   */
  #resolveChecked(file) {
    if (file.length === 0) throw new RangeError("[memory] \u8BB0\u5FC6\u6587\u4EF6\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A");
    if (isAbsolute(file) || file.startsWith("~")) {
      throw new RangeError(`[memory] \u8BB0\u5FC6\u6587\u4EF6\u8DEF\u5F84\u5FC5\u987B\u662F\u76F8\u5BF9\u8DEF\u5F84:${file}`);
    }
    if (!file.endsWith(".md")) throw new RangeError(`[memory] \u8BB0\u5FC6\u6587\u4EF6\u5FC5\u987B\u662F .md:${file}`);
    const abs = resolve(this.#root, file);
    const rel = relative(this.#root, abs);
    if (rel.startsWith("..") || isAbsolute(rel) || rel.length === 0) {
      throw new RangeError(`[memory] \u8BB0\u5FC6\u6587\u4EF6\u8DEF\u5F84\u8D8A\u51FA\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55:${file}`);
    }
    return abs;
  }
}
function tokenize(query) {
  return query.trim().toLowerCase().split(/\s+/u).filter((term) => term.length > 0);
}
function toRelative(file) {
  return file.replace(/^\.\//u, "");
}
async function collectMarkdown(root, dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdown(root, abs, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(relative(root, abs));
    }
  }
}
async function ensureDir(dir, root) {
  const created = [];
  const chain = [];
  let cursor = dir;
  while (cursor.length >= root.length && cursor !== root) {
    chain.unshift(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const current of chain) {
    try {
      await mkdir(current);
      created.push(current);
    } catch (error) {
      if (!isNodeNoSuchFileError(error) && !isNodeExistsError(error)) throw error;
    }
  }
  return created;
}
async function pruneEmptyDirs(dirs) {
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir);
      if (entries.length > 0) continue;
      await rm(dir, { recursive: true, force: true });
    } catch {
    }
  }
}
function excerptOf(line) {
  const trimmed = line.trim();
  const chars = Array.from(trimmed);
  return chars.length <= EXCERPT_MAX_CHARS ? trimmed : `${chars.slice(0, EXCERPT_MAX_CHARS).join("")}\u2026`;
}
function isNodeNoSuchFileError(error) {
  return isNodeErrorWithCode(error, "ENOENT");
}
function isNodeExistsError(error) {
  return isNodeErrorWithCode(error, "EEXIST");
}
function isNodeErrorWithCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
export {
  NotesStore,
  tokenize
};
