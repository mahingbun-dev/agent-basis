/**
 * 从 `@eterna/knowledge` 推导出的结构类型别面(唯一 import 该包的**类型**入口)。
 *
 * 为什么单独一个文件:`verbatimModuleSyntax` 下 `import type` 会被完全擦除,不产生运行期依赖;
 * 但把"哪些符号来自包、哪些是本包自有"集中在**一个**文件里,便于 Lead 在打包 external
 * 决策时一眼看清边界(见 package.json 注释与 README 安装形态)。
 *
 * 取用方式:`typeof import(...)` 的下标类型,不写死任何类名重导出链。
 */
type KnowledgeModule = typeof import('@eterna/knowledge')

/** 提案补丁入参(`WikiLocalBackend.propose` 的形状)。 */
export type DocPatch = Parameters<KnowledgeModule['WikiLocalBackend']['prototype']['propose']>[0]

/** 检索命中(与 DocRef / Provenance 组合体)。 */
export type KnowledgeHit = Awaited<ReturnType<KnowledgeModule['WikiLocalBackend']['prototype']['search']>>[number]

/** 持久化提案记录。 */
export type KnowledgeProposal = ReturnType<KnowledgeModule['WikiLocalBackend']['prototype']['listProposals']>[number]

/** `@eterna/knowledge` 的错误载体(只读 name 判类别,不解析 message)。 */
export type KnownErrorLike = { readonly name?: string }

/** 已挂载的 knowledge 服务面(只声明本包实际消费的两个方法)。 */
export interface KnowledgeService {
  search(query: { query: string; top_k?: number; mode?: 'hybrid' | 'keyword' | 'semantic' }): Promise<
    Awaited<ReturnType<KnowledgeModule['WikiLocalBackend']['prototype']['search']>>
  >
}
