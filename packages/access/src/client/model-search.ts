/**
 * 模型菜单模糊搜索(2026-11-23,ZCode 模型菜单搜索的同构语义)。
 *
 * 口径(对齐上游 model-provider-section/utils.tsx 的 fuzzyMatch 与
 * chat-input-toolbar/display.tsx 的 matchesModelDisplayNameSearch):
 * - 作用域只认**展示名**(name):上游明确修正过「搜索不得命中分组名/模型值」,
 *   避免同名模型混入无关结果;
 * - 大小写不敏感;查询按空白拆词,每个词都必须是展示名的**子序列**
 *   (字符按序出现即可,不要求连续——「v41f」能命中「deepseek-v4.1-flash」);
 * - 空查询恒真(不过滤),保持菜单原有全量列表。
 *
 * 纯函数、无 DOM:可见列表与键盘高亮的语义全部单测锁定(见 tests/model-search.spec.ts)。
 */

/** 菜单可搜模型的最小结构(目录 CatalogModel 的子集)。 */
export interface SearchableModel {
  readonly id: string
  readonly name: string
}

/** 查询规范化:去首尾空白 + 小写(仅用于比较,不改写展示)。 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** 单条文本是否命中查询:空白拆词,每词按序子序列匹配;空查询恒真。 */
export function fuzzyMatch(text: string, query: string): boolean {
  const haystack = text.trim().toLowerCase()
  const normalized = normalizeQuery(query)
  if (normalized === '') return true
  const parts = normalized.split(/\s+/).filter(Boolean)
  return parts.every((part) => {
    let from = 0
    for (const char of part) {
      const found = haystack.indexOf(char, from)
      if (found < 0) return false
      from = found + 1
    }
    return true
  })
}

/** 过滤可见模型:保持目录原顺序(不重排,避免搜索时行位跳动)。 */
export function filterModels<T extends SearchableModel>(
  models: readonly T[],
  query: string,
): readonly T[] {
  const normalized = normalizeQuery(query)
  if (normalized === '') return models
  return models.filter(model => fuzzyMatch(model.name, normalized))
}

/**
 * 键盘高亮步进(输入框内 ArrowDown/ArrowUp):
 * - 列表空 ⇒ null(无高亮);
 * - 尚无高亮 ⇒ 下键落首个、上键落末个;
 * - 已有高亮 ⇒ 环绕移动(首↔尾循环),与常见搜索列表一致。
 */
export function stepIndex(
  current: number | null,
  delta: 1 | -1,
  length: number,
): number | null {
  if (length <= 0) return null
  if (current === null || current < 0 || current >= length) {
    return delta > 0 ? 0 : length - 1
  }
  return ((current + delta) % length + length) % length
}
