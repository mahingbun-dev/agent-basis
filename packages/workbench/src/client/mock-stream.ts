/**
 * 浏览器半边的 mock 流客户端——★M4 起仅为测试 fixture(38 号 T15/G2-D11:
 * 「M4 实接后 mock 为配置/代码路径变更,不留 mock 残留开关」)。客户端装载路径
 * (client/index.ts)已切真源 createLiveStreamController;本文件不再被任何客户端
 * 入口引用,仅为 tests/mock-stream.spec.ts 等传输层 fixture 用例保留——mock 时间线
 * (src/stream/mock-source.ts)与 dev 服务(dev-server.ts/scripts/dev-sse.mjs)同此
 * fixture 定位。mock 时代的 window 覆写键(__ETERNA_WORKBENCH_MOCK_STREAM__)已随
 * mock 开关拆除;引擎实现以 live-stream.ts 为单一事实源,本文件只是地址不同的
 * fixture 包装。
 */
import { createLiveStreamController, type WorkbenchStreamController, type WorkbenchStreamState } from './live-stream.ts'

/** dev mock 流缺省地址(pnpm --filter @eterna/workbench run dev:sse;仅 fixture/dev 工具用)。 */
export const DEFAULT_MOCK_STREAM_URL = 'http://127.0.0.1:8788/api/workbench-mock/stream'

export type { WorkbenchStreamController, WorkbenchStreamState }

/**
 * mock 流控制器(fixture):引擎与真源同一实现(地址不同),行为语义逐字段一致
 * ——fixture 测试的结论对真源控制器同样成立。
 * @param url - 显式地址(测试注入临时端口;缺省 DEFAULT_MOCK_STREAM_URL)。
 */
export function createMockStreamController(url?: string): WorkbenchStreamController {
  return createLiveStreamController(url ?? DEFAULT_MOCK_STREAM_URL)
}
