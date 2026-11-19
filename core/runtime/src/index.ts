/** @core/runtime —— basis 运行时(bundle 装载 + CLI)。 */
export { bootBundle, parseManifest, parseManifestYaml, resolveEntryModule } from './boot.ts'
export type { BootedBundle, BundleEntry, BundleManifest } from './boot.ts'
export { processIo, runBasis, runCliMain } from './cli.ts'
export type { CliIo } from './cli.ts'
