/** @basis/skills —— basis 技能目录、system prompt 目录与 `skill` 工具。 */
export {
  DEFAULT_MAX_SKILL_BYTES, DEFAULT_MAX_SKILLS, DEFAULT_SKILL_DIRS,
  readSkillContent, renderSkillCatalog, renderSkillContent, scanSkills,
} from './store.ts'
export type { SkillContentView, SkillEntry, SkillScanOptions, SkillScanResult } from './store.ts'
export {
  SKILLS_PLUGIN_NAME, SKILLS_SECTION_NAME, SKILL_TOOL_NAME,
  createSkillsService, defineSkillsPlugin,
} from './plugin.ts'
export type { BasisSkillsService, SkillsPluginConfig } from './plugin.ts'
export {
  SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, SKILL_NAME_PATTERN, SKILL_WHEN_TO_USE_MAX,
  SkillFormatError, parseSkillMarkdown, skillNameIssue,
} from './format.ts'
export type { ParsedSkill } from './format.ts'
export { default } from './plugin.ts'
