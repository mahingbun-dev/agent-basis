/**
 * KV 表契约(channels 消费的结构镜像,原 dsh-storage-domain KvTable 形态):
 * get/put/delete/deleteMany/update/entries/keys/size 全量域表面;
 * 异步实现(promise 返回)与同步实现都可赋值。
 */
export interface KvTable<V> {
  get(key: string): V | undefined
  put(key: string, value: V): void | Promise<void>
  delete(key: string): boolean | Promise<boolean>
  deleteMany(keys: readonly string[]): number | Promise<number> | void | Promise<void>
  update(key: string, fn: (current: V) => V): V | Promise<V> | void | Promise<void>
  entries(): IterableIterator<[string, V]>
  keys(): IterableIterator<string>
  readonly size: number
}

/** 内存 KvTable(测试与轻量场景)。 */
export function memoryKvTable<V>(): KvTable<V> {
  const map = new Map<string, V>()
  return {
    get: key => map.get(key),
    put: (key, value) => { map.set(key, value) },
    delete: key => map.delete(key),
    deleteMany: (keys) => {
      let count = 0
      for (const key of keys) {
        if (map.delete(key)) count += 1
      }
      return count
    },
    update: (key, fn) => {
      const current = map.get(key)
      if (current === undefined) return current
      const next = fn(current)
      map.set(key, next)
      return next
    },
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size(): number {
      return map.size
    },
  }
}
