---
name: dsh-doc
description: Use when a task needs facts about EternaAgent itself, such as how a feature, setting, plugin, agent preset, tool, or Cordis API of the running installation works; when the user asks to design, review, build, install, enable, or debug an EternaAgent plugin, bundle, MCP connection, agent preset, plugin icon or detail page, or an EternaAgent tool definition or skill; and when upgrading a plugin or profile to a newer EternaAgent release. Loading it grants no permission to change files or the profile.
---

# EternaAgent documentation

<!-- EternaAgent 适配段(2026-11-18;上游 re-diff 重放时保留本段并重放替换): -->
<!-- EternaAgent 不提供 plugin_manager/plugin_market 工具(三方准入红线,工具行维持裁切)。 -->
<!-- 个人工具型插件走 install_personal_plugin 即时装载(免重启,仅本人会话可见); -->
<!-- 全员可用走「我的插件」转内置(admin 审批);UI/bundle 型需管理员手工 bundle 安装。 -->
<!-- 其余上游散文(segment 下方的 installation flow、references)仍适用于 bundle 形态的 -->
<!-- 设计参考;其中所有 install_bundle 指令在本部署中不可执行,替换为上述两条路径。 -->
<!-- 本 skill 是品牌化 fork(基线 dsh-v0.2.2-rc.5 dsh-doc):源文件位于 EternaAgent 仓库 -->
<!-- packages/brand/skills/dsh-doc;部署时经 @eterna/creation-skills(=packages/brand)装载。 -->

**EternaAgent 安装路径(本部署唯一有效)**:工具型插件作者到工作区 `plugins/<目录名>/`(契约见 `references/personal-tools.md`,最小模板 `templates/personal-tool/`),然后调用 `install_personal_plugin`(`dir`=目录名)——进程内即时装载,免审批免重启,仅本人会话可见,装完即用;全局可用让用户在设置弹窗「我的插件」发起转内置(管理员审批后即刻全员生效)。上游 `plugin_manager` 在 EternaAgent 已裁切,不要调用。

Answer questions about EternaAgent from the documentation and source of the installed version, not from memory, and extend EternaAgent through bundles installed in the current profile.

Loading this skill does not authorize changes. Write bundle files, run mutating `plugin_manager` actions such as installing, enabling, disabling, or removing, or change a preset only when the user asks to change EternaAgent or its profile. For a question, design, or review, read-only lookups, including `list_plugins` and `list_bundles` within your tool permissions, remain available; report findings and leave files and the profile unchanged. A request for an image, widget, or decoration that does not target EternaAgent, such as its Web UI or profile, is not a request for an EternaAgent plugin; deliver the ordinary artifact the task asks for.

## Find facts in this order

1. Runtime inspection, when `cordis_inspect_list` and `cordis_inspect_query` are among your tools: exact Service methods and Event modes, a mounted plugin's Config schema and `packageDir`, the Tools this Agent can call, and live Client Slots and theme tokens.
2. The installed documentation and package sources, located as `references/locate-docs.md` describes.
3. When an answer depends on a live API that you can neither inspect nor read, state what remains unverified. Do not change a preset or the profile to gain tools.

## Read next

The files below live in this skill's base directory, which the `skill` tool reported, and the table is the complete list: do not enumerate that directory. Read them with the file-read tool, write copies into the workspace with the file-write tool, and verify a copy by reading it back. In Desktop the directory sits inside `app.asar`, which the file-read tool and the runtime that `references/locate-docs.md` describes can open; native utilities such as `ls`, `cat`, `cp`, and `cmp`, the glob and search tools, a `node` from `PATH`, and pnpm fail on it. Never install or syntax-check a template in place; copy its contents into the workspace first.

| Task | File |
|---|---|
| Find the installed version's documentation and package sources | `references/locate-docs.md` |
| Build, install, enable, or debug a plugin or bundle | `references/plugin-development.md` |
| Bundle manifest, locale resources, detail document, icons, installation, Host exports and Config | `references/host-plugin.md` |
| Bundle descriptions, optional single-image details, locale paths and preview verification | `references/plugin-details.md` |
| Save plugin configuration or credentials | `references/configuration.md` |
| Web UI: Client manifest, module loader, slot registration | `references/ui-plugin.md` |
| Connect an MCP server through a configuration-only bundle | `references/mcp-bundle.md` |
| Choose extension points, contexts, and state mechanisms | `references/practices.md` |
| Share application operations between UI actions and agent tools | `references/user-actions.md` |
| Verify a page or panel, review its user experience, or work without browser control | `references/verification.md` |
| Draw icons and feature images | `references/artwork.md` |
| Create, change, or migrate an agent preset; choose Host or preset placement | `references/compositions.md` |
| Upgrade a plugin or profile to a newer EternaAgent release | `references/upgrading.md` |
| Loader patch dialect | `references/composition-reference.md` |
| Installable plugin packages, one table per package group | `references/packages.md` |
| Write an EternaAgent tool definition, skill, or multi-step workflow | `references/tool-design.md` |
| EternaAgent 个人工具插件契约(本部署增量) | `references/personal-tools.md` |
| UI plugin template | `templates/decoration/package.json`, `templates/decoration/cordis.patch.yml`, `templates/decoration/index.js`, `templates/decoration/client.js`, `templates/decoration/locale`, `templates/decoration/docs/DETAIL.md`, `templates/decoration/docs/preview.svg`, `templates/decoration/icon.svg` |
| MCP bundle template | `templates/mcp/package.json`, `templates/mcp/cordis.patch.yml`, `templates/mcp/locale`, `templates/mcp/docs/DETAIL.md`, `templates/mcp/docs/preview.svg`, `templates/mcp/icon.svg` |
| 个人工具插件模板(本部署增量) | `templates/personal-tool/package.json`, `templates/personal-tool/index.js` |
