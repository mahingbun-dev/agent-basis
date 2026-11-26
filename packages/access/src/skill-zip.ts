/**
 * 技能 zip 包读取器(零依赖:中央目录 + node:zlib)。
 *
 * 只接受普通 zip(非 zip64/非加密/非分卷),压缩方式 store(0) 与 deflate(8)。
 * 解压前用中央目录声明的大小做硬上限,解压时再用 `maxOutputLength` 兜底——
 * 声明值与实际流不符的炸弹包直接失败,不会把内存吃穿。
 *
 * 路径纪律:拒绝绝对路径、`..`、反斜杠、盘符与 NUL;拒绝符号链接条目;
 * 跳过 `__MACOSX/` 与 `.DS_Store`(macOS 压缩常见噪声)。目录条目必须零长。
 * 同名文件(大小写不敏感)拒绝——Linux 大小写敏感但同一个技能包跨平台应一致。
 *
 * 上限(SKILL_ZIP_*):包 ≤2MiB、解压总量 ≤4MiB、条目 ≤200、单文件 ≤1MiB。
 */
import { inflateRawSync } from 'node:zlib'

/** zip 原始字节上限。 */
export const SKILL_ZIP_MAX_BYTES = 2 * 1024 * 1024
/** 解压后总字节上限。 */
export const SKILL_ZIP_MAX_UNCOMPRESSED = 4 * 1024 * 1024
/** 条目数上限(含目录)。 */
export const SKILL_ZIP_MAX_ENTRIES = 200
/** 单文件解压后上限。 */
export const SKILL_ZIP_MAX_ENTRY_BYTES = 1024 * 1024
/** 单条路径长度上限。 */
const ZIP_PATH_MAX = 240

/** zip 格式/安全校验失败。 */
export class SkillZipError extends Error {}

/** 解出的一条普通文件。 */
export interface SkillZipFile {
  /** 包内相对路径(统一 `/`)。 */
  readonly path: string
  readonly data: Buffer
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN = 22
const EOCD_MAX_SEARCH = 65_535
const CENTRAL_HEADER = 46
const LOCAL_HEADER = 30

/** 读取技能 zip,返回普通文件列表。 */
export function readSkillZip(input: Buffer): SkillZipFile[] {
  if (input.length === 0) throw new SkillZipError('zip 文件为空')
  if (input.length > SKILL_ZIP_MAX_BYTES) {
    throw new SkillZipError(`zip 不能超过 ${SKILL_ZIP_MAX_BYTES / 1024 / 1024}MB`)
  }
  const eocd = findEocd(input)
  const disk = input.readUInt16LE(eocd + 4)
  const centralDisk = input.readUInt16LE(eocd + 6)
  const entriesThisDisk = input.readUInt16LE(eocd + 8)
  const entriesTotal = input.readUInt16LE(eocd + 10)
  const centralSize = input.readUInt32LE(eocd + 12)
  const centralOffset = input.readUInt32LE(eocd + 16)
  if (disk !== 0 || centralDisk !== 0 || entriesThisDisk !== entriesTotal) {
    throw new SkillZipError('不支持分卷 zip')
  }
  if (entriesTotal === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new SkillZipError('不支持 zip64')
  }
  if (entriesTotal === 0) throw new SkillZipError('zip 内没有文件')
  if (entriesTotal > SKILL_ZIP_MAX_ENTRIES) {
    throw new SkillZipError(`zip 条目不能超过 ${SKILL_ZIP_MAX_ENTRIES} 个`)
  }
  if (centralOffset + centralSize > input.length || centralOffset < 0) {
    throw new SkillZipError('zip 中央目录越界')
  }

  const files: SkillZipFile[] = []
  const seen = new Set<string>()
  let cursor = centralOffset
  let totalUncompressed = 0
  for (let index = 0; index < entriesTotal; index += 1) {
    if (cursor + CENTRAL_HEADER > input.length || input.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new SkillZipError('zip 中央目录损坏')
    }
    const flags = input.readUInt16LE(cursor + 8)
    const method = input.readUInt16LE(cursor + 10)
    const crc32 = input.readUInt32LE(cursor + 16)
    const compressedSize = input.readUInt32LE(cursor + 20)
    const uncompressedSize = input.readUInt32LE(cursor + 24)
    const nameLength = input.readUInt16LE(cursor + 28)
    const extraLength = input.readUInt16LE(cursor + 30)
    const commentLength = input.readUInt16LE(cursor + 32)
    const diskStart = input.readUInt16LE(cursor + 34)
    const externalAttrs = input.readUInt32LE(cursor + 38)
    const localOffset = input.readUInt32LE(cursor + 42)
    const next = cursor + CENTRAL_HEADER + nameLength + extraLength + commentLength
    if (next > input.length) throw new SkillZipError('zip 中央目录条目越界')
    const nameBytes = input.subarray(cursor + CENTRAL_HEADER, cursor + CENTRAL_HEADER + nameLength)
    const rawName = nameBytes.toString('utf8')
    cursor = next

    if ((flags & 0x1) !== 0) throw new SkillZipError('不支持加密 zip')
    if (diskStart !== 0) throw new SkillZipError('不支持分卷 zip')
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new SkillZipError('不支持 zip64')
    if (method !== 0 && method !== 8) throw new SkillZipError(`不支持的压缩方式 ${method}`)

    const isDirectory = rawName.endsWith('/')
    const path = normalizeEntryPath(rawName)
    if (path === undefined) continue // macOS 噪声条目:整条跳过
    const mode = (externalAttrs >>> 16) & 0xffff
    const fileType = mode & 0xf000
    if (fileType === 0xa000) throw new SkillZipError(`zip 内含符号链接:${path}`)
    if (isDirectory) {
      if (uncompressedSize !== 0 || compressedSize !== 0) throw new SkillZipError(`目录条目不应有内容:${path}`)
      continue
    }
    if (uncompressedSize > SKILL_ZIP_MAX_ENTRY_BYTES) {
      throw new SkillZipError(`单个文件不能超过 ${SKILL_ZIP_MAX_ENTRY_BYTES / 1024}KB:${path}`)
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > SKILL_ZIP_MAX_UNCOMPRESSED) {
      throw new SkillZipError(`解压后总量不能超过 ${SKILL_ZIP_MAX_UNCOMPRESSED / 1024 / 1024}MB`)
    }
    const key = path.toLowerCase()
    if (seen.has(key)) throw new SkillZipError(`zip 内路径重复:${path}`)
    seen.add(key)

    const data = readEntryData(input, localOffset, compressedSize, uncompressedSize, method, path)
    if (crc32 !== 0 && crc32Of(data) !== crc32) throw new SkillZipError(`zip 条目校验失败:${path}`)
    files.push({ path, data })
  }

  if (files.length === 0) throw new SkillZipError('zip 内没有可安装的文件')
  return files
}

/** 定位 EOCD(允许尾部无注释;尾部注释长度必须与声明一致)。 */
function findEocd(input: Buffer): number {
  const start = Math.max(0, input.length - EOCD_MIN - EOCD_MAX_SEARCH)
  for (let offset = input.length - EOCD_MIN; offset >= start; offset -= 1) {
    if (input.readUInt32LE(offset) !== EOCD_SIGNATURE) continue
    const commentLength = input.readUInt16LE(offset + 20)
    if (offset + EOCD_MIN + commentLength === input.length) return offset
  }
  throw new SkillZipError('不是有效的 zip 文件')
}

/** 读取并解压一条文件;校验本地头与中央目录声明一致。 */
function readEntryData(
  input: Buffer,
  localOffset: number,
  compressedSize: number,
  uncompressedSize: number,
  method: number,
  path: string,
): Buffer {
  if (localOffset + LOCAL_HEADER > input.length || input.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new SkillZipError(`zip 本地头损坏:${path}`)
  }
  const nameLength = input.readUInt16LE(localOffset + 26)
  const extraLength = input.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + LOCAL_HEADER + nameLength + extraLength
  const dataEnd = dataStart + compressedSize
  if (dataStart < 0 || dataEnd > input.length) throw new SkillZipError(`zip 数据越界:${path}`)
  const compressed = input.subarray(dataStart, dataEnd)
  if (method === 0) {
    if (compressedSize !== uncompressedSize) throw new SkillZipError(`zip 存储条目大小不一致:${path}`)
    return Buffer.from(compressed)
  }
  let data: Buffer
  try {
    data = inflateRawSync(compressed, { maxOutputLength: uncompressedSize + 1 })
  } catch {
    throw new SkillZipError(`zip 解压失败:${path}`)
  }
  if (data.length !== uncompressedSize) throw new SkillZipError(`zip 解压大小与声明不一致:${path}`)
  return data
}

/** 规范化包内路径;macOS 噪声返回 undefined(整条跳过)。 */
function normalizeEntryPath(raw: string): string | undefined {
  if (raw.includes('\0')) throw new SkillZipError('zip 路径含 NUL')
  if (raw.includes('\\')) throw new SkillZipError(`zip 路径不能包含反斜杠:${raw.slice(0, 80)}`)
  if (raw.startsWith('/') || /^[A-Za-z]:/u.test(raw)) throw new SkillZipError(`zip 不允许绝对路径:${raw.slice(0, 80)}`)
  const withoutTrailing = raw.endsWith('/') ? raw.slice(0, -1) : raw
  const segments = withoutTrailing.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SkillZipError(`zip 路径非法:${raw.slice(0, 80)}`)
    }
  }
  if (withoutTrailing.length > ZIP_PATH_MAX) throw new SkillZipError('zip 路径过长')
  if (segments[0] === '__MACOSX') return undefined
  if (withoutTrailing === '.DS_Store' || withoutTrailing.endsWith('/.DS_Store')) return undefined
  return withoutTrailing
}

let crcTable: Uint32Array | undefined

/** CRC32(IEEE),用于发现损坏/伪造条目。 */
function crc32Of(data: Buffer): number {
  let table = crcTable
  if (table === undefined) {
    table = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      table[index] = value >>> 0
    }
    crcTable = table
  }
  let crc = 0xffffffff
  for (const byte of data) crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xff] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}
