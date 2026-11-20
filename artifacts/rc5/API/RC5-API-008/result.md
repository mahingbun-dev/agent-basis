# RC5-API-008 — LlmError 构造签名静态扫描

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:128`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:04:26.457Z → 2026-11-19T22:04:26.457Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

grep `LlmError` 构造，无旧构造签名残留。

## 实际

扫描 15 处 `new LlmError(...)`：全部为 `(message, code[, options])`，无单参/多参/非法 code；2 处 `LlmError.fromFailure(...)` 参数数合法。扫描规则自检 19/19。

## 断言

- [x] 无旧构造签名残留
- [x] 构造点非空（扫描面有效）

## 备注

- 扫描面为 packages/tools/core/scripts 的源码，排除 lib/dist/tests。

## 证据

- `cmd.log`
- `../ENV/_suite/verify-rc5-env.json`
