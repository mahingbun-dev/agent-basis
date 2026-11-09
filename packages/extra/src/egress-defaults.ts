/**
 * egress 默认域名白名单(「数据不出内网」红线的缺省口径;T8,§11.6 裁定
 * @basis/extra egress 白名单首期挂载)。
 *
 * 缺省 fail-closed:白名单只含内网 —— 192.168.31.0/24、localhost、MaNas/NAS
 * 主机名;公网域必须显式写进资产配置文件(模板 assets/egress-whitelist.template.yml,
 * 留扩展注释)才放行,web 检索是唯一显式出站、由「工具级白名单 + 本域名级白名单」
 * 双口径管控。
 *
 * /24 编码事实:DomainRule 的 host 语法是点分标签 + 标签级通配(domain-whitelist.ts
 * 头注规则语法段),不支持 CIDR —— `192.168.31.*` 的尾标签通配(labelPattern 的
 * `*` → `[^.]+`,恰一个标签)枚举第四个八位组,语义等价 /24;且标签字符集只允许
 * a-z 0-9 - 与 *(normalizeRuleHost),`/` 非法,CIDR 字面量会被构造期拒绝,天然防呆。
 */
import { DomainWhitelist } from './domain-whitelist.ts'
import type { DomainRule } from './domain-whitelist.ts'

/** 默认(无配置文件时)的域名白名单规则:仅内网,任意端口。 */
export const DEFAULT_EGRESS_DOMAIN_RULES: readonly DomainRule[] = [
  { host: '192.168.31.*' }, // 内网网段 192.168.31.0/24(尾标签通配编码,见头注)
  { host: 'localhost' }, // 本机回环名
  { host: 'manas' }, // NAS 主机名(判定大小写不敏感:URL host 小写化后精确匹配;WeKnora 等内网服务走 http://MaNas:PORT)
]

/** 默认白名单判定器(每次返回新实例;规则集不可变,实例可全局共享)。 */
export function defaultEgressWhitelist(): DomainWhitelist {
  return new DomainWhitelist(DEFAULT_EGRESS_DOMAIN_RULES)
}
