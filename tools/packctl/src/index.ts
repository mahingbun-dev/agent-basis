/**
 * @eterna/packctl —— L2 领域包脚手架 CLI(T5;承载方式 B',12 号文档 §10.1)。
 *
 * 公共 API:
 * - initPack:按 06 号 SOP §2 模板生成领域包骨架(package.json 的 dsh.bundle 指向
 *   cordis.patch.yml / profile.yml / persona.md / skills / tools / knowledge /
 *   policies / evals/golden / hitl.yaml);
 * - lintPack / lintPacks:结构完整 + Cordis 纪律静态检查(无旁路全局、可交换接口形态)
 *   + SKILL.md 条目锚点配对(ACE,10 号文档 §4.1)+ golden 完整性;
 * - checkPack:静态冒烟(bundle 声明引用的文件都存在);
 * - promptScan:提示词登记铁律静态检查(T2.5;登记真值=prompt-studio 注册表);
 * - loadGoldenCaseText / loadGoldenDir:golden 加载器,供 @eterna/evals 复用。
 * - runPack:CLI 入口(bin/packctl.mjs)。
 */
export { runPack } from './cli.ts'
export type { CliIo } from './cli.ts'
export { initPack } from './init.ts'
export type { InitOptions, InitResult } from './init.ts'
export { lintPack, lintPacks, anyLintErrors } from './lint.ts'
export type { PackLintResult } from './lint.ts'
export { checkPack } from './check.ts'
export type { PackCheckResult } from './check.ts'
export { loadGoldenCaseText, loadGoldenDir } from './golden.ts'
export type { GoldenDirResult } from './golden.ts'
export { discoverPackRoots, isPackDir, scanSkills, listToolSources, readPackPackageJson } from './pack.ts'
export type { SkillFile, SkillScanResult } from './pack.ts'
export { lintSkillFile, lintSkillLayout } from './skills.ts'
export type { EvoEntryMeta } from './skills.ts'
export { lintToolModule, lintServiceIdRegistry } from './cordis.ts'
export type { ServiceIdExport } from './cordis.ts'
export { lintProfile, lintStructure, REQUIRED_DIRS, REQUIRED_FILES } from './structure.ts'
export type { StructureContext } from './structure.ts'
export { error, hasErrors, scopeOf, warning } from './types.ts'
export type {
  DshBundleManifest, DshManifest, Finding, GoldenBudget, GoldenCase, GoldenFinalState, GoldenHttpAssert,
  GoldenFileAssert, GoldenJudge, GoldenScriptAssert, GoldenTrajectory, PackPackageJson,
} from './types.ts'
export { promptScan, PROMPT_SCAN_WHITELIST } from './prompt.ts'
export type { PromptScanOptions, PromptWhitelistEntry } from './prompt.ts'
export { parseEntryAnchors, splitFrontmatter, stripCommentsLineByLine, parseYaml } from './util.ts'
export type { EntryAnchor, FrontmatterResult, StrippedLine, YamlResult } from './util.ts'
