/**
 * K1.2 能力契约层单测(36 号 §3 表验收门禁):
 * - 枚举/版本/参数 schema(五能力、CONTRACT_VERSION=1、各能力字段与默认值、越界拒绝);
 * - 禁入键静态拒绝(构造含 strict/functions 等的声明必须被 zod[schemastery] 拒绝,含嵌套深度);
 * - 命名规范校验函数正反例(^[a-zA-Z0-9_-]+$ 且 ≤64,29a R3);
 * - tool_choice 契约语义(三值+嵌套形;glm/mimo 降级位登记)。
 */
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_IDS,
  CAPABILITY_PARAM_SCHEMAS,
  CONTRACT_VERSION,
  TOOL_CHOICE_DOWNGRADES,
  CapabilityRequestError,
  ForbiddenKeyError,
  createCapabilityRequest,
  findForbiddenKeys,
  normalizeToolChoice,
  parseCapabilityParams,
  assertNoForbiddenKeys,
} from '../src/contract/index.ts'
import { TOOL_NAME_MAX_LENGTH, TOOL_NAME_PATTERN, ToolNameError, assertValidToolName, isValidToolName } from '../src/contract/naming.ts'

describe('能力契约:枚举与版本(29 §1 ①)', () => {
  it('五能力枚举恰为 web_search/read_url/files/tts/asr', () => {
    expect([...CAPABILITY_IDS]).toEqual(['web_search', 'read_url', 'files', 'tts', 'asr'])
  })

  it('CONTRACT_VERSION=1(O-7:版本化语义未拍板,先落常量+断言)', () => {
    expect(CONTRACT_VERSION).toBe(1)
  })

  it('五能力各有一份参数 schema(tts/asr 为占位 schema)', () => {
    for (const capability of CAPABILITY_IDS) {
      expect(CAPABILITY_PARAM_SCHEMAS[capability]).toBeDefined()
    }
  })
})

describe('能力契约:web_search 参数 schema(与 GLM 子字段 1:1;29a R1)', () => {
  it('缺省项回填默认值(engine=search_std/count=10/recency=noLimit/contentSize=medium)', () => {
    const parsed = parseCapabilityParams('web_search', { query: '场地选址' })
    expect(parsed.query).toBe('场地选址')
    expect(parsed.engine).toBe('search_std')
    expect(parsed.count).toBe(10)
    expect(parsed.recency).toBe('noLimit')
    expect(parsed.contentSize).toBe('medium')
  })

  it('engine 四值档全收,五值外拒绝', () => {
    for (const engine of ['search_std', 'search_pro', 'search_pro_sogou', 'search_pro_quark']) {
      expect(parseCapabilityParams('web_search', { query: 'q', engine }).engine).toBe(engine)
    }
    expect(() => parseCapabilityParams('web_search', { query: 'q', engine: 'bing' })).toThrow()
  })

  it('count 边界:1 与 50 收,0 与 51 拒(GLM 1–50;29a R1)', () => {
    expect(parseCapabilityParams('web_search', { query: 'q', count: 1 }).count).toBe(1)
    expect(parseCapabilityParams('web_search', { query: 'q', count: 50 }).count).toBe(50)
    expect(() => parseCapabilityParams('web_search', { query: 'q', count: 0 })).toThrow()
    expect(() => parseCapabilityParams('web_search', { query: 'q', count: 51 })).toThrow()
  })

  it('recency 五值收,枚举外拒绝', () => {
    expect(parseCapabilityParams('web_search', { query: 'q', recency: 'oneDay' }).recency).toBe('oneDay')
    expect(() => parseCapabilityParams('web_search', { query: 'q', recency: 'oneHour' })).toThrow()
  })

  it('contentSize 两值收,枚举外拒绝', () => {
    expect(parseCapabilityParams('web_search', { query: 'q', contentSize: 'high' }).contentSize).toBe('high')
    expect(() => parseCapabilityParams('web_search', { query: 'q', contentSize: 'low' })).toThrow()
  })

  it('query 缺失拒绝(必填)', () => {
    expect(() => parseCapabilityParams('web_search', { count: 5 })).toThrow()
  })
})

describe('能力契约:read_url/files/语音参数 schema', () => {
  it('read_url 默认 timeout=20 秒、returnFormat=markdown(GLM reader;29a R1)', () => {
    const parsed = parseCapabilityParams('read_url', { url: 'https://example.com/a' })
    expect(parsed.url).toBe('https://example.com/a')
    expect(parsed.timeout).toBe(20)
    expect(parsed.returnFormat).toBe('markdown')
  })

  it('files 只表达意图:layoutAware 默认 false(purpose 是提供方翻译产物,29a R4)', () => {
    expect(parseCapabilityParams('files', {}).layoutAware).toBe(false)
    expect(parseCapabilityParams('files', { layoutAware: true }).layoutAware).toBe(true)
    expect(() => parseCapabilityParams('files', { layoutAware: 'yes' })).toThrow()
  })

  it('tts/asr 本批仅枚举占位:任何字段拒绝(P-3/O-9)', () => {
    expect(parseCapabilityParams('tts', {})).toEqual({})
    expect(parseCapabilityParams('asr', {})).toEqual({})
    expect(() => parseCapabilityParams('tts', { voice: 'tongtong' })).toThrow(/O-9/)
    expect(() => parseCapabilityParams('asr', { format: 'wav' })).toThrow(/O-9/)
  })
})

describe('能力契约:禁入键静态拒绝(29 §2.1;29a R3/R4)', () => {
  it('构造含 strict 的声明被拒绝(zod ValidationError 链路)', () => {
    expect(() => createCapabilityRequest('web_search', { query: 'q', strict: true })).toThrow()
  })

  it('构造含 functions 的声明被拒绝', () => {
    expect(() => createCapabilityRequest('web_search', { query: 'q', functions: [] })).toThrow(ForbiddenKeyError)
  })

  it('OpenAI 特有字段逐键拒绝(29a R3 清单)', () => {
    for (const key of ['strict', 'custom', 'allowed_tools', 'namespace', 'defer_loading', 'functions', 'function_call', 'function_call_output', 'previous_response_id']) {
      const violations = findForbiddenKeys({ [key]: 1 })
      expect(violations, `键 ${key} 应命中禁入清单`).toHaveLength(1)
      expect(violations[0]?.source).toBe('openai')
    }
  })

  it('提供方特有字段逐键拒绝(encrypted_content/signature/web_search_usage)', () => {
    for (const key of ['encrypted_content', 'signature', 'web_search_usage']) {
      const violations = findForbiddenKeys({ [key]: 1 })
      expect(violations, `键 ${key} 应命中禁入清单`).toHaveLength(1)
      expect(violations[0]?.source).toBe('provider')
    }
  })

  it('嵌套深度禁入键同样命中(domainFilter 数组内对象藏 signature)', () => {
    const violations = findForbiddenKeys({ query: 'q', domainFilter: [{ domain: 'a.com', signature: 'x' }] })
    expect(violations).toHaveLength(1)
    expect(violations[0]?.path).toBe('$.domainFilter[0].signature')
    expect(() => {
      assertNoForbiddenKeys({ query: 'q', domainFilter: [{ domain: 'a.com', signature: 'x' }] })
    }).toThrow(ForbiddenKeyError)
  })

  it('合法声明零命中', () => {
    expect(findForbiddenKeys({ query: 'q', count: 5, domainFilter: ['a.com'] })).toEqual([])
  })

  it('未知能力与非对象 params 拒绝', () => {
    expect(() => {
      createCapabilityRequest('vision' as never, {})
    }).toThrow(CapabilityRequestError)
    expect(() => {
      createCapabilityRequest('web_search', null)
    }).toThrow(CapabilityRequestError)
    expect(() => {
      createCapabilityRequest('web_search', ['q'])
    }).toThrow(CapabilityRequestError)
  })

  it('产出冻结的 CapabilityRequest', () => {
    const request = createCapabilityRequest('read_url', { url: 'https://example.com' })
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.params)).toBe(true)
  })
})

describe('契约命名规范(29a R3:^[a-zA-Z0-9_-]+$ 且 ≤64)', () => {
  it('正例:字母/数字/下划线/连字符,长度 1–64', () => {
    for (const name of ['a', 'knowledge_search', 'web-search-2', 'A_b-9', 'x'.repeat(64)]) {
      expect(isValidToolName(name), `名字 "${name}" 应合法`).toBe(true)
    }
  })

  it('反例:空名/超长/含点/含空格/含斜杠/含中文', () => {
    for (const name of ['', 'x'.repeat(65), 'a.b', 'a b', 'a/b', '工具名', 'a$b']) {
      expect(isValidToolName(name), `名字 "${name}" 应非法`).toBe(false)
    }
  })

  it('assertValidToolName 违例抛 ToolNameError(含上限数字)', () => {
    expect(() => {
      assertValidToolName('ok_name')
    }).not.toThrow()
    expect(() => {
      assertValidToolName('bad.name')
    }).toThrow(ToolNameError)
    expect(() => {
      assertValidToolName('x'.repeat(TOOL_NAME_MAX_LENGTH + 1))
    }).toThrow(/64/)
  })

  it('模式常量与上限常量钉死', () => {
    expect(TOOL_NAME_PATTERN.source).toBe('^[a-zA-Z0-9_-]+$')
    expect(TOOL_NAME_MAX_LENGTH).toBe(64)
  })
})

describe('契约 tool_choice 语义(29a R3 三值+嵌套形;R1/R2 降级位)', () => {
  it('三值 none/auto/required 原样通过', () => {
    for (const choice of ['none', 'auto', 'required'] as const) {
      expect(normalizeToolChoice(choice)).toBe(choice)
    }
  })

  it('嵌套指定形合法且函数名过命名规范', () => {
    expect(normalizeToolChoice({ type: 'function', function: { name: 'knowledge_search' } })).toEqual({
      type: 'function',
      function: { name: 'knowledge_search' },
    })
    expect(() => normalizeToolChoice({ type: 'function', function: { name: 'bad.name' } })).toThrow(ToolNameError)
  })

  it('非法形态拒绝(字符串/数字/缺 function 位)', () => {
    expect(() => normalizeToolChoice('always')).toThrow()
    expect(() => normalizeToolChoice(1)).toThrow()
    expect(() => normalizeToolChoice({ type: 'function' })).toThrow()
  })

  it('降级位登记:glm 与 mimo 一律降为 auto(29a R1/R2 修正)', () => {
    expect(TOOL_CHOICE_DOWNGRADES).toEqual({ glm: 'auto', mimo: 'auto' })
  })
})
