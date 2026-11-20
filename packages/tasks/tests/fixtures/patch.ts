/**
 * cordis.patch.yml 的测试解析面(preset.spec / role-models.spec 共用)。
 *
 * `disabled: !!js …` 表达式是 DSH 装载语义('yaml' 包核心 schema 无 !!js 标签,解析即抛
 * Unknown tag):静态结构断言解析前把 `!!js …` 行置换为 `disabled: false` 占位——被置换的
 * 键值不在两个 spec 的断言面(preset.spec 的平台分支断言只钉 bash-sandbox 行存在与
 * timeoutMs,disabled 随平台;DA 排布即装载行为,归 super 真 boot 门禁 G1-2)。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { CORDIS_PATCH_FILE } from '../../src/session/presets.ts'

/** 包根 cordis.patch.yml 原文(单真值)。 */
export const patchText = readFileSync(fileURLToPath(new URL(`../../${CORDIS_PATCH_FILE}`, import.meta.url)), 'utf8')

/** 解析为顶层行数组(YAML 列表保序——行序断言即数组序)。 */
export const parseTasksPatch = (): Array<Record<string, unknown>> =>
  parseYaml(patchText.replace(/^([ \t]*)disabled: !!js.*$/gm, '$1disabled: false')) as Array<Record<string, unknown>>

/** !!js 置换(与包源同口径;被置换的 disabled 值不在断言面,见文件头注)。 */
const stripJsTags = (text: string): string => text.replace(/^([ \t]*)disabled: !!js.*$/gm, '$1disabled: false')

/** super 容器模板原文(R22 restatement 的模板半边;40 号 S-3 纪律 2)。 */
export const superTemplateText = readFileSync(fileURLToPath(new URL('../../../../docker/profile/cordis.super.patch.yml.template', import.meta.url)), 'utf8')

/** 开发档 super profile 原文(R22 restatement 的开发档半边;与容器模板成对,G1-2 装载面)。 */
export const devSuperProfileText = readFileSync(fileURLToPath(new URL('../../../../profiles/eterna-super/cordis.patch.yml', import.meta.url)), 'utf8')

/** 通用行解析(!!js 置换后 YAML → 顶层行数组;列表保序)。 */
export const parseRows = (text: string): Array<Record<string, unknown>> =>
  parseYaml(stripJsTags(text)) as Array<Record<string, unknown>>

/** 一份 patch 文档内 insert 块的全部行(平铺;R22 restatement 断言面取 preset 行用)。 */
export const insertRowsOf = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
  rows.flatMap(row => (Array.isArray(row.insert) ? row.insert as Array<Record<string, unknown>> : []))
