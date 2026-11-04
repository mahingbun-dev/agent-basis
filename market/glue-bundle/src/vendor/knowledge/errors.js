class KnowledgeError extends Error {
  constructor(message) {
    super(message);
    this.name = "KnowledgeError";
  }
}
class KnowledgeFormatError extends KnowledgeError {
  constructor(message, options) {
    super(message);
    this.name = "KnowledgeFormatError";
    if (options !== void 0 && options.cause !== void 0) this.cause = options.cause;
  }
}
class KnowledgeNotFoundError extends KnowledgeError {
  constructor(message) {
    super(message);
    this.name = "KnowledgeNotFoundError";
  }
}
class KnowledgeStateError extends KnowledgeError {
  constructor(message) {
    super(message);
    this.name = "KnowledgeStateError";
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export {
  KnowledgeError,
  KnowledgeFormatError,
  KnowledgeNotFoundError,
  KnowledgeStateError,
  isRecord
};
