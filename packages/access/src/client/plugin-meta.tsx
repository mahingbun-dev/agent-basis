/**
 * 恒灵插件卡片元数据:原生插件页 artwork + 中文标题/一句话描述。
 *
 * 图标语言 v1:36px 双色线稿(前景 currentColor + 单一品牌强调色),
 * 与界面图标共用「恒环·节点」网格;不再使用渐变与上游插画色。
 * 描述取自各包 package.json description 的一句压缩,不编造功能。
 */
import { pluginArtSvg, type PluginArtName } from './plugin-art.ts'

export interface ArtworkProps {
  readonly size?: number
}

function Artwork({ name, size = 36 }: ArtworkProps & { readonly name: PluginArtName }): React.JSX.Element {
  return (
    <span
      style={{ display: 'inline-flex', width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: pluginArtSvg(name, size) }}
    />
  )
}

function artworkFor(name: PluginArtName): (props: ArtworkProps) => React.JSX.Element {
  return function PluginArtwork(props: ArtworkProps): React.JSX.Element {
    return <Artwork name={name} size={props.size ?? 36} />
  }
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
    desc: '规则引擎与预算守卫:allow/ask/deny、PII 过滤与出网白名单的治理核心。',
    Artwork: artworkFor('governance'),
  },
  'eterna-audit': {
    title: '审计',
    desc: '会话事件投影为按日轮转的审计留痕,支持分页游标查询。',
    Artwork: artworkFor('audit'),
  },
  'eterna-egress': {
    title: '出网闸门',
    desc: '出网工具白名单与代理注入,拦截未授权外联。',
    Artwork: artworkFor('egress'),
  },
  'eterna-access': {
    title: '门禁',
    desc: '登录、账号与用户管理,产品内功能的统一门禁。',
    Artwork: artworkFor('access'),
  },
  'eterna-memory': {
    title: '记忆',
    desc: '项目与实体记忆的读写检索,写入先过 PII 过滤。',
    Artwork: artworkFor('memory'),
  },
  'eterna-knowledge': {
    title: '知识底座',
    desc: '本地知识库混合检索,提案制写入,未过审不入检索。',
    Artwork: artworkFor('knowledge'),
  },
  'eterna-llm-doctor': {
    title: '模型诊断',
    desc: '模型承载行体检:端点探测与逐模型连通性测试。',
    Artwork: artworkFor('doctor'),
  },
  'eterna-brand': {
    title: '品牌层',
    desc: '品牌面替换:标题、favicon 与侧栏徽标换装恒灵·EternaAgent。',
    Artwork: artworkFor('brand'),
  },
  'eterna-panel': {
    title: '基座面板',
    desc: '侧栏基座面板:服务清单、操作指引与只读可观测快照。',
    Artwork: artworkFor('panel'),
  },
  'eterna-prompt-studio': {
    title: '提示词工作室',
    desc: 'persona 查看与受治理的编辑、版本回滚与导入导出。',
    Artwork: artworkFor('prompt'),
  },
}
