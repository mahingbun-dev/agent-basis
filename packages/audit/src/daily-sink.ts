/**
 * 按日轮转文件 sink:NDJSON 追加写,文件名 = <prefix>YYYYMMDD.jsonl(at 的 UTC 日)。
 *
 * 设计依据(企业插件设计 §3.1 查询面):append-only 无轮转的单一 .basis/audit.jsonl 在
 * 长期宿主下不可接受,v1 二选一定死「按日分文件」;日期取记录自带 at(ISO,投影器恒以
 * toISOString 产出)的 UTC 日——确定、可测、不依赖写进程时区。
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuditRecord, AuditSink } from '@basis/governance'

export class DailyFileAuditSink implements AuditSink {
  readonly label: string
  readonly dir: string
  readonly #prefix: string
  #dirReady: Promise<void> | undefined

  constructor(dir: string, prefix = 'audit-', label = 'file-daily') {
    this.dir = dir
    this.#prefix = prefix
    this.label = label
  }

  /** 一条记录应落的文件路径(at 缺席按当前 UTC 日)。 */
  filePathFor(at: string | undefined): string {
    const iso = at ?? new Date().toISOString()
    const day = iso.slice(0, 10).replaceAll('-', '')
    return join(this.dir, `${this.#prefix}${day}.jsonl`)
  }

  async write(record: AuditRecord): Promise<void> {
    await this.#ensureDir()
    await appendFile(this.filePathFor(record.at), `${JSON.stringify(record)}\n`, 'utf8')
  }

  /** flush = 目录屏障(AuditProjector.flush 会调用;appendFile 本身逐条落盘,无缓冲层)。 */
  async flush(): Promise<void> {
    await this.#ensureDir()
  }

  #ensureDir(): Promise<void> {
    this.#dirReady ??= mkdir(this.dir, { recursive: true }).then(() => undefined)
    return this.#dirReady
  }
}
