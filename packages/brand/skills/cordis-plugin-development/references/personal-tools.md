<!-- EternaAgent 适配文档(2026-11-18;非上游文件,re-diff 重放时保留)。 -->

# Personal tool plugins(EternaAgent 个人工具插件契约)

个人插件 = `$DSH_HOME/workspaces/<账号>/plugins/<目录名>/` 下的一个目录,由 T6 装载器进程内装载(免重启)。装载后工具仅本人会话可见;他人会话/系统任务的工具目录不受影响。

## 目录契约(fail-closed,违反即拒载并在「我的插件」显示原因)

```
plugins/hello/
├── package.json     # { "name": "...", "version": "0.0.0", "type": "module", "main": "index.js" }
└── index.js         # Host 半边:export function apply(ctx) { ctx.tools.register({...}) }
```

- `main` 必须指向 `.js`/`.mjs` 纯 JS(ESM 或 CJS 皆可;TS 先编译,不编译会被拒载)。
- 入口导出 `apply(ctx)`;可选 `inject`,只允许缺省或 `["tools"]`——越权(如 `webServer`、`llm`)拒载。
- `ctx` 是受限对象:**只有 `ctx.tools.register(def)`**(自动加 `user_<账号>_` 名前缀 + 归属可见性;disposer 由装载器收管)。没有 `ctx.webServer`/`ctx.reflect`/事件面——路由、服务注入、UI 一律不可用。
- manifest 带 `dsh.client`(UI)或 `dsh.bundle.patch`(bundle)→ 拒载:个人层只承载工具型;这类走管理员 bundle 安装。
- 工具 `name` 须匹配 `^[\w][\w.-]{0,63}$`;同账号两插件撞工具名 → 后装者失败,先停用同名插件或改名。

## 流程

1. 把插件写到当前用户工作区的 `plugins/<目录名>/`(该目录即安装位置,不搬移文件)。
2. 调用 `install_personal_plugin`,`dir`=目录名(或该目录绝对路径,必须仍在本人 plugins 目录内);`name` 缺省取目录名。
3. 读取输出:`已安装并装载 user:<账号>:<名>,工具即刻可用:user_<账号>_<工具名>` = 成功;`装载失败:<原因>` = 按原因修复文件后重新安装(同目录重装 = 原子替换,ESM 缓存已破除)。
4. 管理面:设置弹窗「我的插件」可启停/移除(全部即时生效);「转内置」发起全员发布(管理员审批)。

## 边界(诚实声明)

- 受限 ctx 不是沙箱:插件代码在本进程内受信执行(与宿主插件同信任级;防线=契约校验+归属可见性+审计+转内置人审)。
- 个人层不承载 UI/服务型插件;PTC/TS 运行时(workflow)产物不在装载范围。
- 最小模板:`templates/personal-tool/`(package.json + index.js)。
