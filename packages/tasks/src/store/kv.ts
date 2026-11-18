/**
 * 类型化 KV 键表——按「唯一拥有并写入该族的那一个部件」分组;读写双方都按本表
 * 的条目引用一条记录,使每个键连同其值类型只拼写一次。
 *
 * 设计依据:34 号 §2.3 kv 行(SA src/kv.ts 原样);35 号 A11。键位机械(Key/Family/
 * record/family)与 SA 逐行同构;KV 条目按本包已落地部件裁剪:store/schema、settings
 * 版本史与 prompts 版本史(A23)三组已随各自拥有者落位,github/feishu 等组属未落地
 * 部件(A21 sources),其键族随拥有者落地再入表——不预登记无法类型化的条目
 * (SA kv.ts:21-58 对照)。
 */
import type { SettingsSave } from '../policy/settings.ts'
import type { PromptVersion } from '../session/prompts.ts'
import type { SettingsVersion } from './store.ts'

/** 一条 KV 记录的键,其值类型为 `V`;纯字符串表示非类型化键。 */
export type Key<V> = string & { readonly __value?: V }
/** 共享一个前缀的 KV 键族:可调用(由名件拼出键),并暴露 `prefix` 供枚举。 */
export type Family<V, A extends unknown[]> = ((...name: A) => Key<V>) & { readonly prefix: string }
/** 定义单个类型化 KV 键。 */
export const record = <V>(key: string) => key as Key<V>
/** 定义一个 KV 键族:键 = `prefix` + 名件以 `:` 连接(或自定义 `format`)。 */
export function family<V, A extends unknown[] = [string]>(prefix: string, format = (...name: A) => name.join(':')): Family<V, A> {
  return Object.assign((...name: A) => `${prefix}${format(...name)}`, { prefix })
}

export const KV = {
  /** Store:当前数据库 schema 版本。 */
  store: { schema: record<number>('schema') },
  /** Settings:当前修订号、分块修订号(每配置页一块,乐观并发)与已保存的 settings 快照(含当前那份)。 */
  settings: {
    revision: record<number>('settings-revision'),
    block: family<number, [block: SettingsSave]>('settings-block-revision:'),
    version: family<SettingsVersion, [revision: number]>('settings-version:'),
  },
  /** Prompts(35 号 A23):配置版本史(修订指针 + 编号快照)、内置文本基档(按 base 键)与每 session 的版本绑定史。 */
  prompts: {
    revision: record<number>('prompts-revision'),
    version: family<PromptVersion, [revision: number]>('prompts-version:'),
    builtIn: family<string, [base: string]>('prompts-built-in:'),
    binding: family<number[], [sessionId: string]>('prompts-binding:'),
  },
}
