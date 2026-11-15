/**
 * 客户端侧端点字符串(会话内两件专用;与宿主面 admin-plugin.ts 的导出同真值,
 * 构建期各自内联,客户端不 import 宿主模块——panel/compaction 同款纪律)。
 * 设置分区的读写端点(state/updateConfig)随 settings.tsx 承载(compaction 同款)。
 */

/** 域清单 / 会话域读取 / 会话域切换端点(域 chip 数据面)。 */
export const MEMORY_DOMAINS_ENDPOINT = 'eternaMemory/domains'
export const MEMORY_SESSION_DOMAIN_ENDPOINT = 'eternaMemory/sessionDomain'
export const MEMORY_SELECT_DOMAIN_ENDPOINT = 'eternaMemory/selectDomain'
