## Primary Request and Intent
- Initial ask: 把压缩阈值调到 0.9 and retainRatio 提到 0.3.
- After the risk review the user settled it: 阈值先不动保持 0.8 (retainRatio stays 0.16), asked to 热更新白名单检查补上测试, and to record the 模型切换报错 error.
- Standing constraint: 白名单不扩,三个键不变.

## Key Technical Concepts
- Compaction pressure config: thresholdRatio 0.8, retainRatio 0.16; overrides hot reload limited to auto/thresholdRatio/retainRatio; new keys need a restart.
- Error surface: TargetPressureConfigError for invalid retain/threshold combos, MODEL_SWITCH_COMPACTION_FAILED on model-switch compaction failure, ManualCompactionError (busy) for manual compaction during an open turn.

## Files and Code
- packages/compaction/src/basic/config.ts: resolveCompactSpec validation the 0.3 proposal failed against.
- packages/compaction/src/basic/index.ts: home of MODEL_SWITCH_COMPACTION_FAILED (agent/request prepend listener).
- packages/compaction/tests/basic-config.spec.ts and packages/compaction/tests/helpers/fakes.ts: existing spec surface, unchanged.
- packages/compaction/tests/basic-hotreload.spec.ts: whitelist-rejection case added (6 passed).
- .eterna/compaction.config.json: stays auto=true, thresholdRatio 0.8, retainRatio 0.16.
- .eterna/compaction.state.json: read-only counter check.
- packages/compaction/evals/facts.ts: golden facts schema the notes feed.
- scripts/verify-eterna-web.mjs: profile smoke passed, PRESET_KEPT_ROWS unchanged.

## Errors and Fixes
- TargetPressureConfigError: retainTokens must be less than threshold tokens under the 120-token window test -> retainRatio 0.3 rejected, kept 0.16.
- MODEL_SWITCH_COMPACTION_FAILED: documented as the switch-compaction failure error; no code change needed.
- ManualCompactionError: manual compaction during an open turn raises busy; documented only.

## Pending Jobs
- Revisit thresholdRatio 0.9 once overflow-recovery metrics exist.

## Current Work
- Decision notes folded into the golden eval material next to packages/compaction/evals/facts.ts. Commands run: pnpm --filter @eterna/compaction run verify; pnpm vitest run tests/basic-hotreload.spec.ts; node scripts/verify-eterna-web.mjs.

## Next Step
- Carry the decision notes into the M-C2 batch; no config change lands now.

## Critical Context
- decision: thresholdRatio stays 0.8; 0.9 deferred — later compaction shifts more load onto overflow recovery.
- retainRatio 0.3 rejected: TargetPressureConfigError retainTokens >= thresholdTokens in the 120-token window test.
- overrides whitelist unchanged: auto/thresholdRatio/retainRatio only; new keys require restart.
- MODEL_SWITCH_COMPACTION_FAILED thrown by the agent/request prepend listener on switch compaction failure.
