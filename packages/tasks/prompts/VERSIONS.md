# prompts/ 版本清单(VERSIONS)

> 35 号 A23 交付件(34 号 §1 prompts/ 树「VERSIONS.md:prompt 版本清单」);数据面对应
> SA src/app/versions.ts 的版本史机制(编号快照 + 当前修订指针,34 号 §2.3「保留在
> store 内部」→ 本仓 `src/store/store.ts` 的 `Versions` 类)。版本绑定每次模型请求
> (24 号 §8.1-4);团队可覆盖但不漂移(34 号 §4-D)。

## 一、资产清单与当前版本(11 件)

每件资产的版本 = 其装配后文本的内容派生 hash(`key('prompt-asset', <装配后文本>)`,
sha256 前 32 位十六进制;装配 = 段内行以空格连接、空行分段,见 `src/session/prompts.ts`
的 `promptFile`)。改资产文本即新版本——`tests/model-surface.spec.ts` 按本清单逐件核对,
清单与文件不一致即 drift。

| 资产 | 覆盖键(PartKey) | 读它的角色 | 版本(hash) |
|---|---|---|---|
| shared.md | runtime/shared | orchestrator+worker | 5ef43de048060d521b465aa574e4c3e0 |
| orchestrator.md | runtime/orchestrator | orchestrator | 93b6332ee9bbb3e171d7ca552153a4f6 |
| worker.md | runtime/worker | worker | b2eb7693aa31c93c213913285e7cd6ac |
| subscriptions.md | runtime/subscriptions | orchestrator+worker | c8c059a67d6cf96d7465eb1fdd21333e |
| replies.md | runtime/replies | orchestrator+worker | 40e769405348a7a3ceac724ed0f0d469 |
| dispatch.md | runtime/dispatch | orchestrator | 43d51cfd8b73650b52b65672b515b8c8 |
| work.md | runtime/work | worker | dedf7fb341c7c99b003bf4fa0b559413 |
| admission.md | runtime/admission | orchestrator | c6d63b8b3357ebf6cd76da57495aa133 |
| handoff.md | runtime/handoff/orchestrator、runtime/handoff/worker 共用前缀 | 按角色拼接 | 4037d7050068281c94d419ac90c00298 |
| handoff-orchestrator.md | runtime/handoff/orchestrator | orchestrator | dce785d8554c38f025eb1f1df88014d0 |
| handoff-worker.md | runtime/handoff/worker | worker | d29a51f0473f4b6ed89f83f8b2581375 |

另有生成段模板两件(不在上表——由装配按运行时数据填充,占位符不随版本清单登记):
`runtime/environment`(`{variables}`)与 `runtime/policy`/`runtime/policy/none`
(`{version}`/`{mode}`/`{rules}`),模板文本随 `src/session/prompts.ts` 代码版本化。

## 二、三层版本机制(谁在哪个面被版本化)

1. **内置资产**(上表 11 件):随包发布,版本 = 内容 hash;本清单是其当前版本的
   唯一登记处。团队对某件的覆盖以 `{text, base}` 记录其编辑自的内置文本键
   (`base = key('prompt-built-in', <内置文本>)`);升级只把变化经
   `Prompts.defaultChanged` 列出,永不改写团队文本——团队显式取舍。
2. **团队配置**(PromptConfig:communication/scope/delivery 三段 + 团队 skill +
   overrides):以编号修订快照存租户库 KV(`prompts-revision` 指针 +
   `prompts-version:<n>` 快照);修订 0 为首次保存前的内置默认,保存走乐观并发
   (`PromptConflict`),全史可回滚(`Prompts.history`)。
3. **运行时绑定**(每次模型请求):每次请求按当前 settings 现算 Policy 段并绑定当次
   修订(`Prompts.bind`,记录进 `prompts-binding:<sessionId>` 的修订史);session 可读
   其活动修订与曾运行过的任一修订(`Prompts.ranUnder`)。

## 三、范围与裁剪登记

- SA `prompts/cli.md` 与 `prompts/team/*.md`(communication/delivery/scope 默认文本)
  不在 34 号 §1 清单内,本包不搬运(35 号 §12-18 开放问题)——团队段默认空文本,
  空段不进 prompt。
- `skill/feishu`、`skill/github` 两个 Source skill 覆盖键属 35 号 A21(sources 面),
  随其落地再入 PART_KEYS 与本清单。
- prompt 文本中文为主、术语保留英文(34 号 §6-9);model-surface 体积预算按重写后
  实测以**字符**重标定,见 `tests/model-surface.spec.ts`(禁止沿用 SA 英文预算)。
