# profiles/eterna-super — super 形态（superagent）挂载清单

`cordis.patch.yml`：super 形态（`ETERNA_FORM=super`）的开发档挂载清单。初始内容 =
`profiles/eterna-web/cordis.patch.yml` 原样拷贝（2026-11-17，40 号 S-3 纪律 1「super 需要
可启动的壳」——Tier2 包 tasks/workbench/toolkit 均未落地，挂不存在的包必 boot failed，
故初始 Tier2 挂载行为空集）。

- 形态定义：31 号 §2.1 super = base ⊕ tasks + channels 挂载 + interact 接线 + workbench
  + toolkit；挂载行随各包落地 PR（WS-A/M1 tasks、WS-B/M2 toolkit、WS-D/M3 workbench、
  WS-E/M4 channels+interact）同步加入，且必须同改 super 模板与本清单两处（FORM001
  看护一致）并双跑 G1-1 + G1-2。
- 裁切面继承 base：super 不回加 base 裁切的行（遥测/账号/场景裁切等）——31 号 §2.1
  的「base ⊕」是加法不是重定义。
- 与模板的一致性：`node tools/packctl/bin/packctl.mjs form-check`（FORM001：insert 块
  内 `@eterna` 挂载行 id+name 按序一致 + base 模板挂载行集 ⊆ super 模板挂载行集）。
- 容器档模板：`docker/profile/cordis.super.patch.yml.template`（entrypoint 按
  `ETERNA_FORM=super` 选它渲染；哈希门控机制原样复用）。
- 真 boot 验证：`node scripts/verify-eterna-super.mjs`（脚本把本清单物化为
  `$DSH_HOME/profiles/eterna-super/cordis.patch.yml`，默认 home 为 `.eterna-super-home/`，
  `ETERNA_PROFILE_HOME` 可覆盖；挂载面断言从本清单派生——挂一行、验一行）。

组合栈（从下到上）：

1. `@deepseek-ai/dsh-base`（bundle 层，装品 0.2.2-rc.1）
2. `@deepseek-ai/dsh-web-app`（bundle 层 + 其 presets/*.patch.yml）
3. 本 `cordis.patch.yml`（profile 用户层，最后写赢；super 挂载行随后续包落地在此追加）
