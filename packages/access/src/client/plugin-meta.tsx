/**
 * 恒灵插件卡片元数据:原生插件页 artwork 同构插画 + 中文标题/一句话描述。
 * - 插画 viewBox 36,固定渐变插画色(品牌插画豁免,同头像渐变逻辑;
 *   容器/描边一律走 --dsw-alias-* 令牌,见 styles.ts)——色板沿用上游
 *   dsh-web-frontend 插画色(#658EFF/#679EFE/#A797FC/#4561EE 及渐变组)
 * - 渐变 id 经 useId 派生(去非标识符字符)防多实例冲突
 * - 描述取自各包 package.json description 的一句压缩,不编造功能
 */
import { useId } from 'react'

export interface ArtworkProps {
  readonly size?: number
}

function useArtId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, '')
}

/** 治理:盾形+对勾(渐变 #69B9FF→#324DE2)。 */
function ArtGovernance({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-governance-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="8" y1="5" x2="28" y2="31" gradientUnits="userSpaceOnUse">
        <stop stopColor="#69B9FF" /><stop offset="1" stopColor="#324DE2" />
      </linearGradient>
    </defs>
    <path d="M18 4.5 L28 8.5 V17 C28 23.5 23.8 28.6 18 31 C12.2 28.6 8 23.5 8 17 V8.5 Z" fill={`url(#${gid})`} />
    <path d="M13.5 17.5 L16.8 20.8 L23 14.5" stroke="#EAF1FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

/** 审计:文档+记录行(#679EFE 描边,渐变强调行)。 */
function ArtAudit({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-audit-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="13" y1="19" x2="24" y2="19" gradientUnits="userSpaceOnUse">
        <stop stopColor="#54ECE7" /><stop offset="1" stopColor="#658EFF" />
      </linearGradient>
    </defs>
    <rect x="8" y="6" width="20" height="24" rx="4" stroke="#679EFE" strokeWidth="3" />
    <path d="M13 13 H23" stroke="#679EFE" strokeWidth="3" strokeLinecap="round" opacity=".7" />
    <path d="M13 19 H23" stroke={`url(#${gid})`} strokeWidth="3" strokeLinecap="round" />
    <path d="M13 25 H18" stroke="#679EFE" strokeWidth="3" strokeLinecap="round" opacity=".45" />
  </svg>
}

/** 出网闸门:地球+出网箭头(#658EFF 环线,#54ECE7→#658EFF 箭头)。 */
function ArtEgress({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-egress-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="21" y1="15" x2="28" y2="8" gradientUnits="userSpaceOnUse">
        <stop stopColor="#54ECE7" /><stop offset="1" stopColor="#658EFF" />
      </linearGradient>
    </defs>
    <circle cx="17" cy="19" r="11.5" stroke="#658EFF" strokeWidth="3" />
    <path d="M17 7.5 C13.8 10.5 12 14.5 12 19 C12 23.5 13.8 27.5 17 30.5" stroke="#658EFF" strokeWidth="3" opacity=".55" />
    <path d="M5.5 19 H28.5" stroke="#658EFF" strokeWidth="3" opacity=".55" />
    <path d="M21 15 L28 8" stroke={`url(#${gid})`} strokeWidth="3" strokeLinecap="round" />
    <path d="M22.5 8 H28 V13.5" stroke={`url(#${gid})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

/** 门禁:锁身渐变+锁环(#69B9FF→#324DE2)。 */
function ArtAccess({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-access-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="9" y1="16" x2="27" y2="30" gradientUnits="userSpaceOnUse">
        <stop stopColor="#69B9FF" /><stop offset="1" stopColor="#324DE2" />
      </linearGradient>
    </defs>
    <path d="M13 16 V12 a5 5 0 0 1 10 0 V16" stroke="#658EFF" strokeWidth="3" />
    <rect x="9" y="16" width="18" height="14" rx="4" fill={`url(#${gid})`} />
    <circle cx="18" cy="21.5" r="2" fill="#EAF1FF" />
    <path d="M18 23 V26" stroke="#EAF1FF" strokeWidth="2" strokeLinecap="round" />
  </svg>
}

/** 记忆:分层堆叠(#A797FC/渐变/#4561EE)。 */
function ArtMemory({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-memory-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="8" y1="19.5" x2="28" y2="19.5" gradientUnits="userSpaceOnUse">
        <stop stopColor="#69B9FF" /><stop offset="1" stopColor="#324DE2" />
      </linearGradient>
    </defs>
    <rect x="8" y="8" width="20" height="6" rx="3" fill="#A797FC" fillOpacity=".55" />
    <rect x="8" y="16.5" width="20" height="6" rx="3" fill={`url(#${gid})`} />
    <rect x="8" y="25" width="20" height="6" rx="3" fill="#4561EE" fillOpacity=".8" />
  </svg>
}

/** 知识底座:翻开书本(#45E7A4→#05909D 线稿)。 */
function ArtKnowledge({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-knowledge-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="8" y1="18" x2="28" y2="18" gradientUnits="userSpaceOnUse">
        <stop stopColor="#45E7A4" /><stop offset="1" stopColor="#05909D" />
      </linearGradient>
    </defs>
    <path d="M18 11 C15.5 8.5 11 8 8 9.5 V26 C11 24.5 15.5 25 18 27.5 C20.5 25 25 24.5 28 26 V9.5 C25 8 20.5 8.5 18 11 Z"
      stroke={`url(#${gid})`} strokeWidth="3" strokeLinejoin="round" />
    <path d="M18 11.5 V27" stroke={`url(#${gid})`} strokeWidth="3" strokeLinecap="round" />
  </svg>
}

/** 模型诊断:脉搏波形(#54ECE7→#658EFF)。 */
function ArtDoctor({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-doctor-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="5" y1="19" x2="31" y2="19" gradientUnits="userSpaceOnUse">
        <stop stopColor="#54ECE7" /><stop offset="1" stopColor="#658EFF" />
      </linearGradient>
    </defs>
    <path d="M5 19 H10.5 L13 12.5 L17 25 L20.5 16 L22.5 19 H31" stroke={`url(#${gid})`}
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

/** 品牌层:闪电(#A797FC→#4561EE)。 */
function ArtBrand({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-brand-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="10" y1="5" x2="26" y2="31" gradientUnits="userSpaceOnUse">
        <stop stopColor="#A797FC" /><stop offset="1" stopColor="#4561EE" />
      </linearGradient>
    </defs>
    <path d="M20 5 L10 20 H17 L15.5 31 L26 15.5 H18.5 Z" fill={`url(#${gid})`} />
  </svg>
}

/** 基座面板:四格布局(#4561EE/渐变/#679EFE/#A797FC)。 */
function ArtPanel({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-panel-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="19" y1="8" x2="28" y2="17" gradientUnits="userSpaceOnUse">
        <stop stopColor="#54ECE7" /><stop offset="1" stopColor="#658EFF" />
      </linearGradient>
    </defs>
    <rect x="8" y="8" width="9" height="9" rx="3" fill="#4561EE" fillOpacity=".8" />
    <rect x="19" y="8" width="9" height="9" rx="3" fill={`url(#${gid})`} />
    <rect x="8" y="19" width="9" height="9" rx="3" fill="#679EFE" fillOpacity=".9" />
    <rect x="19" y="19" width="9" height="9" rx="3" fill="#A797FC" fillOpacity=".75" />
  </svg>
}

/** 提示词工作室:笔尖(#54ECE7→#658EFF)。 */
function ArtPrompt({ size = 36 }: ArtworkProps): React.JSX.Element {
  const gid = `ea-art-prompt-${useArtId()}`
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="18" y1="6" x2="18" y2="27" gradientUnits="userSpaceOnUse">
        <stop stopColor="#54ECE7" /><stop offset="1" stopColor="#658EFF" />
      </linearGradient>
    </defs>
    <path d="M18 6 L25.5 13.5 L21 27 H15 L10.5 13.5 Z" fill={`url(#${gid})`} />
    <circle cx="18" cy="15.5" r="2.2" fill="#EAF1FF" />
    <path d="M18 17.7 V23.5" stroke="#EAF1FF" strokeWidth="2" strokeLinecap="round" />
  </svg>
}

export interface PluginMeta {
  readonly title: string
  readonly desc: string
  readonly Artwork: (props: ArtworkProps) => React.JSX.Element
}

/** 插件 id → 卡片元数据(红线 4 项 + 可停用 6 项,与 routes.ts 登记册对齐)。 */
export const PLUGIN_META: Readonly<Record<string, PluginMeta>> = {
  'eterna-governance': {
    title: '治理',
    desc: '规则引擎与预算守卫：allow/ask/deny、PII 过滤与出网白名单的治理核心。',
    Artwork: ArtGovernance,
  },
  'eterna-audit': {
    title: '审计',
    desc: '会话事件投影为按日轮转的审计留痕，支持分页游标查询。',
    Artwork: ArtAudit,
  },
  'eterna-egress': {
    title: '出网闸门',
    desc: '出网工具白名单与代理注入，拦截未授权外联。',
    Artwork: ArtEgress,
  },
  'eterna-access': {
    title: '门禁',
    desc: '登录、账号与用户管理，产品内功能的统一门禁。',
    Artwork: ArtAccess,
  },
  'eterna-memory': {
    title: '记忆',
    desc: '项目与实体记忆的读写检索，写入先过 PII 过滤。',
    Artwork: ArtMemory,
  },
  'eterna-knowledge': {
    title: '知识底座',
    desc: '本地知识库混合检索，提案制写入，未过审不入检索。',
    Artwork: ArtKnowledge,
  },
  'eterna-llm-doctor': {
    title: '模型诊断',
    desc: '模型承载行体检：端点探测与逐模型连通性测试。',
    Artwork: ArtDoctor,
  },
  'eterna-brand': {
    title: '品牌层',
    desc: '品牌面替换：标题、favicon 与侧栏徽标换装恒灵·EternaAgent。',
    Artwork: ArtBrand,
  },
  'eterna-panel': {
    title: '基座面板',
    desc: '侧栏基座面板：服务清单、操作指引与只读可观测快照。',
    Artwork: ArtPanel,
  },
  'eterna-prompt-studio': {
    title: '提示词工作室',
    desc: 'persona 查看与受治理的编辑、版本回滚与导入导出。',
    Artwork: ArtPrompt,
  },
}
