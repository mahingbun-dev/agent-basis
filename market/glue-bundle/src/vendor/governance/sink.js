import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
class MemoryAuditSink {
  label = "memory";
  records = [];
  write(record) {
    this.records.push(record);
  }
}
class FileAuditSink {
  label;
  filePath;
  #dirReady;
  constructor(filePath, label = "file") {
    this.filePath = filePath;
    this.label = label;
  }
  async write(record) {
    await this.#ensureDir();
    await appendFile(this.filePath, `${JSON.stringify(record)}
`, "utf8");
  }
  async flush() {
    await this.#ensureDir();
  }
  async #ensureDir() {
    this.#dirReady ??= mkdir(dirname(this.filePath), { recursive: true }).then(() => void 0);
    await this.#dirReady;
  }
}
export {
  FileAuditSink,
  MemoryAuditSink
};
