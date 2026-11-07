# T7.0 生效通道 spike 结论（personaPrefix 改动 → 新会话生效）

> 日期：2026-11-07 ｜ 执行：T7.0 尖兵（动态 workflow subagent）｜ 计划书：`plans/2026-11-07-agent-loop可视化与system-prompt前端管理.md` §3/§6/§7
> 断言脚本：`scripts/t7-spike-verify.mjs`（可重复执行，exit 0/1）｜ 隔离运行态：`.basis-home-t7/`（DSH_HOME 指向，Web 宿主 3108）

## 1. 通道结论：**通道 A —— patch 层覆写 + HMR 重载，无需重启宿主进程**

在 Web 宿主（bundle 栈 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`，经 `dsh --profile …` 启动、携带 profileContext）上：

- 宿主进程运行中，**原位改写 profile patch 层**（`profiles/<name>/cordis.patch.yml`）里的会话 persona 前缀（标记 A → 标记 B）；
- **不重启宿主**，新开的会话系统提示即为标记 B；进行中会话保持标记 A 不受影响。

即 T7 的保存链路（T7.1 把编辑内容写回 patch 层后）**默认按「保存即对新建会话生效、无需重启」设计 UI 与验收**；「重启生效」的通道 B fallback 不需要。

**边界（结论不迁移的场景）**：本结论依赖 dsh-base 的 `hmr` 行（`disabled: !!js "!ctx.get('profileContext')"`，见 `dsh-base/cordis.patch.yml:28-32`）。SDK / headless / ACP 等禁用 HMR 的组合里，patch 改动按上游文档「Profile changes take effect on the next process」只在下次进程生效——那些组合等同通道 B。父任务假设「组合差异不影响 personaPrefix 生效机制」在 Web 档（含 T1 裁切组合，只要保留 dsh-base hmr 行 + profileContext 启动）成立；裁切组合**必须保留 hmr 行**，否则保存链路降级为重启生效。

## 2. 组合事实（比预期多出来的一条关键事实）：persona 的 patch 落点不是宿主 system-prompt 行

- 宿主 `system-prompt` 行的 `config.personaPrefix`（`dsh-base/cordis.patch.yml:510-513`）在 Web 组合里**被 agent-preset 的 persona 行遮蔽**：`dsh-web-app/presets/standard.patch.yml:4-32` 给 `preset-standard` 行插入 `plugins: [{ id: persona, name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a coding agent powered by the {{model}} model.' } }, …]`；`dsh-persona` 在 agent 作用域内注册同名段 `DEPLOYMENT_PERSONA_PREFIX`，按 system-prompt 注册表「scoped section shadows a global section with the same name」规则覆盖宿主行注册的全局段（`dsh-persona/lib/index.js`、`dsh-system-prompt/lib/index.js`）。
- **负结果实证**：spike 首轮把 `system-prompt` 行 `personaPrefix` 覆写为标记 A（组合树 dump 确认进树），会话系统提示仍是 web-app 的 preset persona 文本（会话日志 `…/session-2ae36dd2-*/session.v4.jsonl.zstd` 的 `system/message` 无标记 A）。
- 因此 **T7.1 的 persona 写回落点 = profile patch 层的 `preset-standard` 行**（patch 按 id 覆写整行替换 config，需整行复述 plugins 列表；`presets/standard.patch.yml` 头注「Edits saved from the Web editor override this row's `config.plugins` by id from the profile patch」与之一致）。宿主 `system-prompt` 行 personaPrefix 的覆写对 Web 会话无效（SDK 档仍有效）。
- 机制链（静态读源 + 实测一致）：patch 文件变化 → `dsh-hmr` profile watch 重组合（`dsh-hmr` README「Profile and home patch changes also trigger recomposition」）→ loader 对非 volatile 的 config 变更走普通 update 生命周期 = 行重启（`cordis-plugin-loader/lib/index.js` `update()`：`equalExceptVolatile` 不含 `personaPrefix`/`prefix` → 非 volatile-only → `_patchContext` → restart）→ preset 声明更新 → **新会话**组装 agent 平面时读新声明；进行中会话的 scoped persona 段是注册时定死的，不随重组合变化。

## 3. 证据（本轮亲手跑出的命令与输出要点）

脚本化复现（两次连跑均 exit 0，输出见运行日志摘要）：

```
node scripts/t7-spike-verify.mjs   # 第一次：exit 0，17 项断言全 PASS
node scripts/t7-spike-verify.mjs   # 第二次：exit 0（可重复性）
```

断言清单（摘自脚本输出）：

- `preflight: 组合树 persona 前缀=标记 A`（`dsh --profile t7-studio --dump-config` 无 skipping/incompatible）
- `会话 A 系统提示含标记 A`（session-4b782242…/d6aac700…/fa97514a…，经 LITELLM 真模型回合完成）
- `patch 已原位改写 A→B；宿主不重启` + `宿主进程 pid 未变（未重启）`（如 pid=48587 前后一致）
- `会话 B 系统提示含标记 B（新会话无需重启即生效 → 通道 A）` 且不含标记 A
- `宿主日志只有一次 dsh web: 启动行（无二次 boot）`、`宿主日志含 basis-llm-openai → LiteLLM 调用证据`
- `旧会话 A 补轮后系统提示仍无标记 B`（patch=B 后旧会话再跑一轮，新回合的提示仍是 A）
- 停机后磁盘复断言：`磁盘 JSONL(会话 A) 含标记 A、不含标记 B`、`磁盘 JSONL(会话 B) 含标记 B、不含标记 A`
  （断言源为 `$DSH_HOME/sessions/<area>/<sessionId>/session.v4.jsonl.zstd`，多帧 zstd 容器逐帧解码后取 `type:"system/message"` 且 `data.message.source.kind=="system-prompt"` 的事件文本；解码算法对齐 `packages/panel/src/session-logs.ts`）

手动实验同结论（脚本化前）：宿主 pid 47326 全程不变，会话 1（`session-ea3b8afb…`）系统提示含 `T7_SPIKE_PERSONA_MARKER_A`；原位改写 patch 后会话 2（`session-c56ded9a…`）系统提示含 `T7_SPIKE_PERSONA_MARKER_B`；旧会话补跑第二回合（turn/start seq21→turn/end seq27）后其持久化日志仍只有标记 A 的 system-prompt 事件。

隔离与清理：DSH_HOME=`.basis-home-t7`（自包含 profile `profiles/t7-studio`，依赖 `@deepseek-ai/dsh@0.2.2-rc.1` + `file:` 链接 `basis/llm-openai`，pnpm install 在 profile 目录内完成）；宿主监听 3108；进程清理只用 `host.kill('SIGTERM')` + `pkill -f 'profile t7-studio'` 精确模式；结束后 3108 已释放、无遗留 t7 进程。

## 4. 对 T7.1（Host 保存链路）的实现约束

1. **写回落点**：profile patch 层 `preset-standard` 行的 `plugins[id=persona].config.prefix`（整行 config 复述）。生成方式可照抄 `scripts/t7-spike-verify.mjs` 的 `buildPatch()`：读安装包内 `node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 做**纯文本变换**（去掉 `- insert:` 壳、dedent 4 格、替换唯一 `prefix:` 行）——不要经 yaml 库 round-trip（`!!js` 表达式会被剥标签，实测 `disabled: !!js …` 变普通字符串真值导致行语义损坏）。
2. **原子写 + 单写者**：patch 是整文件语义，保存必须 tmp+rename 原子替换、单写者串行（计划 §7 风险项成立）；写前 YAML 可解析性自检可用 `dsh --profile <name> --dump-config` 干跑（脚本 preflight 同款，无副作用）。
3. **HMR 时序**：chokidar `awaitWriteFinish` 约 2s 写稳定窗 + 重组合耗时；保存完成后 UI 提示「对新会话生效」前建议轮询确认（脚本用 8s 等待 + 失败重试 3 次）。成功时宿主日志**无**显式 hmr 行（静默成功），失败才有报错行——不能靠日志确认，靠新会话验证。
4. **版本库/审计照常落 storage/governance**：patch 文件本身不承载版本历史（版本只增不删的版本库是 T7.1 自己的存储），patch 只存「当前生效值」。
5. **KV-cache 提示**（计划 §7）：persona 变化使新会话前缀失配，编辑器显示「影响：新会话前缀将变化」即可，无需估算。

## 5. 对 T7.3（校验器/版本管理）的实现约束

- 校验器红线的「红线段必须存在」检查应针对**最终组合提示**（persona + harness identity + preset 各段）而 persona 编辑只校验 persona 段文本本身（非空、≤64KB 对齐 agent-instructions maxBytes 口径、diff 非空才可保存）。
- 回滚 = 把历史版本内容重新写回 patch 层（产生新版本号），与「版本只增不删」一致；写回后同样走 §4.2/4.3 约束。
- 导入 JSON 包校验 checksum 后，落盘路径与手工保存一致（同一原子写 + 审批链）。

## 6. 对 T7.4（运行态轨迹管线）的时序事实（实测踩坑）

- **`session/wait` 的 `reason:'idle'` 不可作回合完成信号**：回合尚未开跑时也会立即返回 idle；完成判定应以 `session/events` 页面出现 `turn/end` 为准（脚本 `awaitTurnEnd()`）。
- **`session.v4.jsonl.zstd` 落盘时机是后台成帧**：本机实测回合结束后 90s 内文件可能尚未出现；SIGTERM 优雅停机时确定性冲刷。轨迹投影不能假设「回合结束=日志已落盘」，要么轮询 + 容忍缺失，要么走 `session/events`（attached 会话读内存日志，无落盘依赖）。
- 磁盘断言源的多帧 zstd 容器解码沿用 `packages/panel/src/session-logs.ts` 的 `scanZstdFrames/decodeZstdLog`（对齐 persistence-jsonl 公开 one-shot 路径）。

## 7. 环境与凭据

- LITELLM：baseURL 读 `.secrets/litellm-base-url.txt`，key 只从 `.secrets/litellm-master-key.txt` 读进宿主进程环境（`LITELLM_API_KEY`），未写入任何被跟踪文件/日志/输出。
- 版本：profile 依赖 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 均钉 `0.2.2-rc.1`（与 `basis/basis-minimal` 的官方包同版家族）；静态机制读源也取 rc.1 包体。
