/**
 * 流事件校验过滤——36 号 K2.1,翻译 chat-demo `src/services/api/parseEvent.ts`
 * 的 readMessageEvent(「未识别或无法安全消费的事件静默丢弃,不影响后续有效内容与正常结束」)。
 *
 * R4 缺口落点:
 * - stop_reason 按 R4-⑤ 放宽为 5 值(补 stop_sequence);
 * - web_search_tool_result_error 的 error_code 保持 string 宽松校验(枚举外错误码原样保留,
 *   不丢弃证据;6 值枚举映射在 messages.ts 出块侧消费)。
 */
import type {
  ContentBlockDelta,
  MessageStreamEvent,
  OutputBlockStart,
  StopReason,
  TextCitation,
} from './types.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isOptionalString = (value: unknown) => value === undefined || isString(value)
const isNullableString = (value: unknown) => value == null || isString(value)
const isIndex = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0

const isCitation = (value: unknown): value is TextCitation =>
  isRecord(value) &&
  value.type === 'web_search_result_location' &&
  isString(value.url) &&
  isNullableString(value.title)

/** 只检查消费内容所需的字段,签名及服务端附带的信息保持原样。 */
const readBlock = (value: unknown): OutputBlockStart | null => {
  if (!isRecord(value)) {
    return null
  }
  switch (value.type) {
    case 'text':
      if (!isString(value.text)) {
        return null
      }
      return {
        ...value,
        type: 'text',
        text: value.text,
        ...(value.citations === undefined
          ? {}
          : { citations: Array.isArray(value.citations) ? value.citations.filter(isCitation) : [] }),
      } as unknown as OutputBlockStart
    case 'thinking':
      if (!isString(value.thinking)) {
        return null
      }
      return {
        ...value,
        // signature 缺省统一 coerce 为空串(协议在块结束前经 signature_delta 下发;类型必填)。
        signature: isString(value.signature) ? value.signature : '',
      } as unknown as OutputBlockStart
    case 'server_tool_use': {
      const input = value.input
      if (
        !isString(value.id) ||
        !['search', 'deep_search', 'read_link', 'image_search', 'deep_image_search'].includes(
          value.kind as string,
        ) ||
        !['deepseek_web_search', 'deepseek_read_url'].includes(value.name as string) ||
        !isRecord(input)
      ) {
        return null
      }
      switch (input.action) {
        case 'search':
          if (!Array.isArray(input.queries) || !input.queries.every(isString)) {
            return null
          }
          break
        case 'open_page':
        case 'read_link':
          if (!isString(input.url)) {
            return null
          }
          break
        case 'find_in_page':
          if (!isString(input.url) || !isString(input.pattern)) {
            return null
          }
          break
        default:
          return null
      }
      break
    }
    case 'web_search_tool_result':
      if (
        !isString(value.tool_use_id) ||
        !['search', 'deep_search', 'image_search', 'deep_image_search'].includes(
          value.kind as string,
        ) ||
        !Array.isArray(value.content)
      ) {
        return null
      }
      return {
        ...value,
        content: value.content.filter((item) => {
          if (!isRecord(item)) {
            return false
          }
          if (item.type === 'web_search_tool_result_error') {
            return isString(item.error_code)
          }
          return (
            item.type === 'web_search_result' &&
            isString(item.url) &&
            isString(item.title) &&
            isNullableString(item.snippet) &&
            isNullableString(item.site_name) &&
            isNullableString(item.site_icon) &&
            isNullableString(item.page_age)
          )
        }),
      } as unknown as OutputBlockStart
    case 'web_fetch_tool_result': {
      const content = value.content
      if (
        !isString(value.tool_use_id) ||
        !['read_link', 'deep_search'].includes(value.kind as string) ||
        !isRecord(content)
      ) {
        return null
      }
      if (content.type === 'web_fetch_tool_result_error') {
        if (!isString(content.error_code)) {
          return null
        }
      } else if (
        content.type !== 'web_fetch_result' ||
        !isString(content.url) ||
        !isRecord(content.content) ||
        !isNullableString(content.content.title) ||
        !isNullableString(content.published_at)
      ) {
        return null
      }
      return {
        ...value,
        signature: isOptionalString(value.signature) ? value.signature : undefined,
      } as OutputBlockStart
    }
    case 'tool_use':
      // 本通道不发客户端工具;登记此分支仅为防未知形态混入时被静默当正文(与 chat-demo 一致地放行结构校验)。
      break
    default:
      return null
  }
  return value as unknown as OutputBlockStart
}

const readDelta = (value: unknown): ContentBlockDelta | null => {
  if (!isRecord(value)) {
    return null
  }
  switch (value.type) {
    case 'text_delta':
      return isString(value.text) ? (value as ContentBlockDelta) : null
    case 'thinking_delta':
      return isString(value.thinking) ? (value as ContentBlockDelta) : null
    case 'signature_delta':
      return isString(value.signature) ? (value as ContentBlockDelta) : null
    case 'citations_delta':
      return isCitation(value.citation) ? (value as ContentBlockDelta) : null
    default:
      return null
  }
}

const isUsage = (value: unknown) =>
  isRecord(value) &&
  ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].every(
    key => typeof value[key] === 'number' && Number.isFinite(value[key]),
  )

/** stop_reason 合法值(R4-⑤:补 stop_sequence,共 5 值)。 */
const STOP_REASONS: readonly string[] = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'refusal']

/** 未识别或无法安全消费的事件静默丢弃,不影响后续有效内容与正常结束(照 chat-demo 纪律)。 */
export function readMessageEvent(value: unknown): MessageStreamEvent | null {
  if (!isRecord(value)) {
    return null
  }
  switch (value.type) {
    case 'message_start':
      if (!isRecord(value.message)) {
        return null
      }
      return {
        ...value,
        message: {
          ...value.message,
          usage: isUsage(value.message.usage) ? value.message.usage : undefined,
        },
      } as MessageStreamEvent
    case 'content_block_start': {
      const block = readBlock(value.content_block)
      return isIndex(value.index) && block
        ? { type: 'content_block_start', index: value.index as number, content_block: block }
        : null
    }
    case 'content_block_delta': {
      const delta = readDelta(value.delta)
      return isIndex(value.index) && delta
        ? { type: 'content_block_delta', index: value.index as number, delta }
        : null
    }
    case 'content_block_stop':
      if (!isIndex(value.index)) {
        return null
      }
      break
    case 'message_delta':
      if (!isRecord(value.delta) || !STOP_REASONS.includes(value.delta.stop_reason as string)) {
        return null
      }
      return {
        ...value,
        delta: {
          ...value.delta,
          stop_reason: value.delta.stop_reason as StopReason,
          title: isOptionalString(value.delta.title) ? value.delta.title : undefined,
        },
        usage: isUsage(value.usage) ? value.usage : undefined,
      } as MessageStreamEvent
    case 'message_stop':
      break
    default:
      return null
  }
  return value as MessageStreamEvent
}
