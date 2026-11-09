import { isRecord } from "./errors.js";
import { serializeArgs } from "./rules.js";
import { FileAuditSink, MemoryAuditSink } from "./sink.js";
class AuditProjector {
  #sinks;
  #pii;
  #argsPreviewLimit;
  #pending = /* @__PURE__ */ new Map();
  #writes = Promise.resolve();
  #writeError;
  constructor(options) {
    if (options.sinks.length === 0) throw new RangeError("[governance] AuditProjector \u81F3\u5C11\u9700\u8981\u4E00\u4E2A sink");
    this.#sinks = [...options.sinks];
    this.#pii = options.pii;
    this.#argsPreviewLimit = options.argsPreviewLimit ?? 200;
  }
  /** 投影一条事件:返回产生的审计记录(同时已入队写全部 sink)。未识别的事件类型返回空数组(前向兼容 66+ 事件类型)。 */
  projectEvent(event) {
    const records = [];
    if (!isRecord(event.data)) return records;
    switch (event.type) {
      case "tool/call": {
        const key = asString(event.data["callId"]);
        if (key !== "") {
          this.#pending.set(key, {
            seq: event.seq,
            turn: readNumber(event.data["turn"]) ?? 0,
            step: readNumber(event.data["step"]) ?? 0,
            tool: asString(event.data["name"]),
            argsPreview: this.#preview(event.data["arguments"])
          });
        }
        break;
      }
      case "tool/result": {
        const message = event.data["message"];
        if (!isRecord(message)) break;
        const key = asString(message["toolCallId"]);
        const pending = this.#pending.get(key);
        this.#pending.delete(key);
        const error = isRecord(event.data["error"]) ? event.data["error"] : void 0;
        const turn = pending?.turn ?? readNumber(event.data["turn"]);
        const step = pending?.step ?? readNumber(event.data["step"]);
        const tool = pending?.tool ?? "";
        const argsPreview = pending?.argsPreview ?? "";
        const errorName = error !== void 0 && typeof error["name"] === "string" ? error["name"] : void 0;
        records.push({
          kind: "tool-call",
          ...pending?.seq !== void 0 && { seq: pending.seq },
          ...atOf(event),
          ...turn !== void 0 && { turn },
          ...step !== void 0 && { step },
          ...tool !== "" && { tool },
          ...key !== "" && { callId: key },
          ...argsPreview !== "" && { argsPreview },
          isError: message["isError"] === true,
          ...errorName !== void 0 && { errorName }
        });
        break;
      }
      case "turn/end": {
        const turn = readNumber(event.data["turn"]);
        const reason = isRecord(event.data["reason"]) ? asString(event.data["reason"]["kind"]) : "";
        records.push({
          kind: "turn-end",
          ...atOf(event),
          ...event.seq !== void 0 && { seq: event.seq },
          ...turn !== void 0 && { turn },
          ...reason !== "" && { reason }
        });
        break;
      }
      case "assistant/message": {
        const usage = event.data["usage"];
        if (!isRecord(usage)) break;
        const turn = readNumber(event.data["turn"]);
        const step = readNumber(event.data["step"]);
        records.push({
          kind: "usage",
          ...atOf(event),
          ...event.seq !== void 0 && { seq: event.seq },
          ...turn !== void 0 && { turn },
          ...step !== void 0 && { step },
          usage: {
            inputTokens: readNumber(usage["inputTokens"]) ?? 0,
            outputTokens: readNumber(usage["outputTokens"]) ?? 0,
            totalTokens: readNumber(usage["totalTokens"]) ?? 0
          }
        });
        break;
      }
      default:
        break;
    }
    for (const record of records) this.#enqueue(record);
    return records;
  }
  /** 投影一段事件流(逐步调用 projectEvent)。 */
  project(events) {
    const all = [];
    for (const event of events) {
      all.push(...this.projectEvent(event));
    }
    return all;
  }
  /** 等待全部 sink 落账并上抛首个写错误(文件 sink 的显式屏障)。 */
  async flush() {
    await this.#writes;
    for (const sink of this.#sinks) {
      await sink.flush?.();
    }
    if (this.#writeError !== void 0) {
      throw this.#writeError instanceof Error ? this.#writeError : new Error(JSON.stringify(this.#writeError));
    }
  }
  /**
   * 直接投递一条治理侧记录(预算违规/令牌拒绝等)。detail.actor(如有)被提升为记录级
   * actor 字段(企业插件设计 §3.1:⑧插件粒度归属),不再重复出现在 detail 里。
   */
  reportGovernance(detail) {
    const { actor, ...rest } = detail;
    const record = {
      kind: "governance",
      at: (/* @__PURE__ */ new Date()).toISOString(),
      detail: rest,
      ...actor !== void 0 && { actor }
    };
    this.#enqueue(record);
    return [record];
  }
  #enqueue(record) {
    this.#writes = this.#writes.then(async () => {
      for (const sink of this.#sinks) {
        await sink.write(record);
      }
    }).catch((error) => {
      this.#writeError ??= error;
    });
  }
  #preview(rawArgs) {
    if (rawArgs === void 0) return "";
    let text = typeof rawArgs === "string" ? rawArgs : serializeArgs(rawArgs);
    if (this.#pii !== void 0) text = this.#pii.redact(text).text;
    return text.length > this.#argsPreviewLimit ? `${text.slice(0, this.#argsPreviewLimit)}\u2026` : text;
  }
}
function atOf(event) {
  const time = event.time;
  return time !== void 0 ? { at: new Date(time).toISOString() } : {};
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asString(value) {
  return typeof value === "string" ? value : "";
}
export {
  AuditProjector,
  FileAuditSink,
  MemoryAuditSink
};
