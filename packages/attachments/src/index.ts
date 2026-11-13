/**
 * @eterna/attachments Host 半边:idle 装载载具。
 *
 * 数据面(上传/存储/附件栏)全在上游 file-upload + ui-attachment + attachment-local,
 * 本包无宿主服务;但客户端双面包必须有宿主 Loader 条目才能进浏览器花名册
 * (client-modules 只收集宿主条目的 dsh.client 声明,@eterna/compaction-client
 * 同款先例),故本文件仅提供 idle 插件形态供 profile 行挂载。
 */
import type { Context } from '@deepseek-ai/cordis'

/** DSH bundle loader 取 default export 插件实例(对齐 glue 插件形态)。 */
export default {
  name: 'eterna-attachments',
  apply(_ctx: Context): () => void {
    return () => { /* idle:无宿主服务,无资源需要撤销 */ }
  },
}
