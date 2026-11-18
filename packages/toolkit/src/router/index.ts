/** 路由器子路径门面(36 号 §2.2 exports "./router")。 */
export {
  PROVIDER_TABLE,
  BORROW_ORDER,
  findModelRow,
  routeCapability,
} from './router.ts'
export type {
  NativeProviderId,
  ProviderId,
  FilesGranularity,
  AdapterRoute,
  ProviderDeploymentConfig,
  TavilyDeploymentConfig,
  DeploymentConfig,
  ConversationRef,
  ModelRow,
  BorrowPath,
  ProviderRow,
  RouteKind,
  RouteDecision,
} from './router.ts'
export {
  SEARCH_TIER_LABELS,
  computeMatrix,
  createMatrixService,
} from './matrix.ts'
export type { SearchTier, MatrixEntry, CapabilityMatrix, MatrixService } from './matrix.ts'
export {
  GENERIC_TOOL_CALL_FLAGS,
  toGlmWebSearchTool,
  toGlmReaderBody,
  toDeepseekServerTools,
  toDeepseekFilePurpose,
  toGenericFunctionTool,
  toTavilySearchBody,
  toTavilyExtractBody,
  translateToolChoice,
} from './translate.ts'
export type { GlmWebSearchToolDeclaration, GenericFunctionTool, DeepseekServerToolType } from './translate.ts'
