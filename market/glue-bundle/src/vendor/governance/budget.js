import { isRecord } from "./errors.ts";
class BudgetGuard {
  #config;
  #hooks;
  #turns = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #totalTokens = 0;
  #cost = 0;
  #firedDimensions = /* @__PURE__ */ new Set();
  constructor(config = {}, hooks = {}) {
    assertPositive("maxTurns", config.maxTurns);
    assertPositive("maxTokens", config.maxTokens);
    assertPositive("maxCost", config.maxCost);
    this.#config = config;
    this.#hooks = hooks;
  }
  get config() {
    return this.#config;
  }
  /** 投影一条 session 事件并记账;返回本次新产生的违规(已去重:每维度只报一次)。 */
  applyEvent(event) {
    if (event.type === "turn/end" && isRecord(event.data)) {
      this.#turns += 1;
    } else if (event.type === "assistant/message" && isRecord(event.data)) {
      const usage = event.data["usage"];
      if (isRecord(usage)) {
        const input = readCount(usage["inputTokens"]) ?? 0;
        const output = readCount(usage["outputTokens"]) ?? 0;
        const total = readCount(usage["totalTokens"]) ?? input + output;
        this.#inputTokens += input;
        this.#outputTokens += output;
        this.#totalTokens += total;
        const pricing = this.#config.pricing;
        if (pricing !== void 0) {
          this.#cost += input / 1e6 * (pricing.inputPerMTokens ?? 0) + output / 1e6 * (pricing.outputPerMTokens ?? 0);
        }
      }
    }
    return this.#reportNew();
  }
  /** 当前用量快照。 */
  usage() {
    return {
      turns: this.#turns,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      totalTokens: this.#totalTokens,
      cost: this.#cost
    };
  }
  /** 是否已有任一维度超限(截断总开关)。 */
  exhausted() {
    return this.#violations().length > 0;
  }
  /** 按当前已入账用量评估全部违规(不落去重状态,纯查询)。 */
  check() {
    return this.#violations();
  }
  /** turn-stopping 边界纯决策。turn = 即将关闭的这一轮(计入后即第 max(已完成, turn) 轮)。 */
  directive(turn) {
    const effectiveTurns = Math.max(this.#turns, turn);
    const violations = this.#violations(effectiveTurns);
    if (violations.length === 0) return { action: "allow-close" };
    return {
      action: "cancel",
      cause: { kind: "hook", reason: `[governance] \u9884\u7B97\u8D85\u9650:${violations.map((v) => v.message).join(";")}` },
      violations
    };
  }
  /**
   * dsh `agent/turn-stopping` seam 形态的事件处理器(签名见 types.ts:TurnStoppingHandler)。
   * 超预算 → agent.cancel({kind:'hook'})(硬截断);未超 → 不动作(允许正常收口)。
   * 组合层注册示例:ctx.on('agent/turn-stopping', (e) => guard.onTurnStopping(e))。
   */
  onTurnStopping = (event) => {
    const d = this.directive(event.turn);
    if (d.action === "cancel") {
      event.agent.cancel(d.cause);
      for (const violation of d.violations) this.#fire(violation);
    }
  };
  /**
   * token/cost 超限后的工具截断守卫:exhausted 时对一切调用 deny。
   * 组合层应在 tools/pre-execute(或 ctx.tools.guard)处先于规则引擎调用。
   */
  preExecuteGuard = (call) => {
    if (!this.exhausted()) return { kind: "allow" };
    const violations = this.#violations();
    return { kind: "deny", reason: `[governance] \u9884\u7B97\u5DF2\u8017\u5C3D,\u62D2\u7EDD\u7EE7\u7EED\u6267\u884C\u5DE5\u5177 ${call.name}:${violations.map((v) => v.message).join(";")}` };
  };
  /** 重置记账(测试/会话重建用)。 */
  reset() {
    this.#turns = 0;
    this.#inputTokens = 0;
    this.#outputTokens = 0;
    this.#totalTokens = 0;
    this.#cost = 0;
    this.#firedDimensions.clear();
  }
  #violations(effectiveTurns = this.#turns) {
    const violations = [];
    const { maxTurns, maxTokens, maxCost } = this.#config;
    if (maxTurns !== void 0 && effectiveTurns > maxTurns) {
      violations.push({
        dimension: "turns",
        limit: maxTurns,
        actual: effectiveTurns,
        message: `turn \u8D85\u9650:${effectiveTurns} > ${maxTurns}`
      });
    }
    if (maxTokens !== void 0 && this.#totalTokens > maxTokens) {
      violations.push({
        dimension: "tokens",
        limit: maxTokens,
        actual: this.#totalTokens,
        message: `token \u8D85\u9650:${this.#totalTokens} > ${maxTokens}`
      });
    }
    if (maxCost !== void 0 && this.#cost > maxCost) {
      violations.push({
        dimension: "cost",
        limit: maxCost,
        actual: this.#cost,
        message: `cost \u8D85\u9650:${this.#cost} > ${maxCost}`
      });
    }
    return violations;
  }
  #reportNew() {
    const fresh = [];
    for (const violation of this.#violations()) {
      if (this.#firedDimensions.has(violation.dimension)) continue;
      this.#firedDimensions.add(violation.dimension);
      fresh.push(violation);
      this.#fire(violation);
    }
    return fresh;
  }
  #fire(violation) {
    this.#firedDimensions.add(violation.dimension);
    try {
      this.#hooks.onViolation?.(violation);
    } catch {
    }
  }
}
function readCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function assertPositive(name, value) {
  if (value !== void 0 && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`[governance] BudgetConfig.${name} \u5FC5\u987B\u662F\u6B63\u6570,\u5F97\u5230:${value}`);
  }
}
export {
  BudgetGuard
};
