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
