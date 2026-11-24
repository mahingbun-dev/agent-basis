# 发布流程(含「更新说明」强制项)

> 本文件是**发版唯一入口**。任何一个版本,只有走完这里的五步才算可部署。
> 设计依据:[55 号 · 版本更新介绍弹窗与部署门禁](design/55-版本更新介绍弹窗与部署门禁.md)。

## 一句话

**升版本 → 截图 → 写文案 → 过门禁 → 部署。** 缺一步,`deploy/release-notes-check.sh`
或容器 entrypoint 会把人拦下来。

## 0. 事实源

| 事实 | 位置 | 约束 |
| --- | --- | --- |
| 版本号 | 仓库根 `VERSION` | 唯一事实源;镜像 tag 必须与之相等 |
| 本版说明 | `releases/<VERSION>/release.json` | 必须存在;12 条门禁(G-RN-01..12) |
| 素材 | `releases/<VERSION>/assets/` | webp/png/jpg,1440×900;动图 webm |
| 截图剧本 | `releases/<VERSION>/shots.plan.json` | 首次截图自动生成;改选择器可修 |
| 采集留痕 | `releases/<VERSION>/.shots.json` | 脚本写;逐文件 sha256 + 浏览器版本 |
| 门禁留痕 | `releases/<VERSION>/.gate.json` | 门禁通过时写;部署后可对账 |

> 版本号只存在于一处。历史上它散落在 `.env` 与镜像 tag 里(55 号 §5.1 实测),
> 那是「无版本可判」的状态,已终结。

## 1. 升版本

```bash
# 方式 A:脚手架顺带写 VERSION
node scripts/release-notes-new.mjs 0.2.2 --set-version

# 方式 B:先改 VERSION 再建骨架
printf '0.2.2\n' > VERSION
node scripts/release-notes-new.mjs 0.2.2
```

规则:

- **内容变了就必须升版本**。同版本重发 = 已读用户的弹窗永远不会再出现。
- **版本升了就必须有说明**,哪怕只有一页「修复若干问题」;骨架会故意留 `TODO`
  让门禁红着,直到文案写完。
- rc / 内部预发布:`announce:false`,不弹给用户,但清单照样要过门禁(内容留痕)。

## 2. 截图(自动化,D5)

```bash
node scripts/release-shots.mjs --version=0.2.1                # base 形态
node scripts/release-shots.mjs --version=0.2.1 --form=super    # super 面(生产形态;含任务工坊)
```

它做什么:真启动一份**隔离实例**(临时 DSH_HOME + 播种管理员 + OS 分配端口)→
Chrome(headless,1440×900,浅色)按剧本走界面 → **Playwright 原生 webp**(无需
cwebp/sharp)→ 写 `.shots.json` 并回填 `release.json` 的 `media.sha256`。

- 场景失败**不伪造图**:默认跳过并列出原因,`--strict` 则直接失败。
- 验收用开关(不进正式素材):`--viewport=760x900`、`--color-scheme=dark`,
  配合 `--plan=<file> --out=<tmp>` 可对弹窗本身按断点/深浅主题取证。
- 本机 pnpm 依赖树若缺 peer(pnpm `autoInstallPeers:false` 的已知坑,表现为
  启动时一片 `ERR_MODULE_NOT_FOUND`/`pending`),不改仓库 node_modules:跑一份
  `npm i --prefix /tmp/shots-dsh @deepseek-ai/dsh@<repo package.json 的版本>`,
  再 `RELEASE_SHOTS_DSH=/tmp/shots-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js ...`。
  CI 用 lockfile 安装,不受影响。
- 需要「动作」的页用 `record-browser-gif` 技能录 webm(≤8s/≤2MB),poster 用截图。
- CI:`Actions → CI → Run workflow`(job `release-shots`)与本地同一条命令,
  产物是 artifact,**不会自动提交**——截图落库属于发布动作,单独确认。

## 3. 写文案

按 55 号 §3.2 的硬规则(门禁可判):

| 项 | 规则 |
| --- | --- |
| 页数 | 3–8 页:首 cover、尾 end、至少 1 页 feature |
| 标题 | ≤18 字 |
| 正文 | ≤120 字 |
| 要点 | ≤4 条,每条 ≤24 字 |
| 图注 | ≤40 字 |
| 封面亮点 | 恰好 3 枚 |
| 图片 | ≥1200×750、比例 1.5–1.75、单张 ≤600KB |
| 动图 | webm ≤2MB,必须配 poster |
| 单版资产 | ≤6MB,`assets/` 不许有孤儿文件 |
| 禁用词 | `dsh-`、`PR #`、`session-`、`TODO`、emoji、内部地址 |

写给用户看:说「你能感知到什么变化」,不说实现细节;不确定的数字不要写。

## 4. 过门禁

```bash
node scripts/release-notes-gate.mjs --hash    # 回填哈希(只改 media.sha256)
node scripts/release-notes-gate.mjs           # 12 条全绿
bash deploy/release-notes-check.sh            # + 镜像 tag 必须等于 VERSION
pnpm -w run verify                            # 全仓(含发布说明门禁)
```

失败对照:

| 报错 | 修法 |
| --- | --- |
| `G-RN-06 ... 文件不存在` | 截图文件名与 `media.src` 不一致,或没跑截图脚本 |
| `G-RN-07 ... 比例 1.6x` | 视口不是 1440×900(脚本默认已是) |
| `G-RN-08 ... sha256 不一致` | 换过图,跑一次 `--hash` |
| `G-RN-10 ... 孤儿文件` | 删掉未引用的旧图 |
| `G-RN-11 ... 禁用词` | 文案里写了内部代号/PR 号/emoji |
| `镜像 tag(...)≠ VERSION(...)` | `.env` 的 `ETERNA_IMAGE` 没跟上版本 |

## 5. 部署

```bash
bash deploy/pre-restart-check.sh     # 近 120s 有会话写入会拒;确认可中断用 FORCE=1
git pull                             # 部署树拿到新的 VERSION/releases/
bash deploy/release-notes-check.sh   # 部署前最后一道
docker compose build && docker compose up -d
bash deploy/verify.sh                # 14 项,含「发布说明 current.version == VERSION」
```

三道冗余是有意的(55 号 §5.3):

1. `release-notes-check.sh`:人按 SOP 跑,最便宜;
2. CI `verify` job:不合规合不进去;
3. 容器 entrypoint:**缺这一版说明就拒启**(fail-closed);
4. 部署后 `verify.sh`:线上真的读到了才算完。

**热修后门**:`ALLOW_MISSING_RELEASE_NOTES=1` 只用于「镜像已坏了、必须先救」的场合,
不进 `.env` 模板;打开时启动日志会留 `WARN ... ALLOW_MISSING_RELEASE_NOTES=1` 一行。

## 6. 用户侧语义(不可改)

- 每个账号每版只弹一次,服务端记 `(user_id, version)`——换设备/清缓存不再弹;
- 任何关闭路径(×、Esc、遮罩、「以后再看」、「知道了」)都算已读(D2);
- **不提供永久退订**(D3):不想看就点一次「以后再看」,之后在「设置 → 更新记录」回看;
- **不补课**:跨版本用户只看最新一版,历史在设置里;
- `announce:false` 的版本不进弹窗,但会出现在「更新记录」历史列表。

## 7. 文件结构

```text
VERSION                          # 0.2.1
releases/0.2.1/
  release.json                   # 清单(门禁 12 条的对象)
  shots.plan.json                # 截图剧本(选择器可修)
  .shots.json                    # 采集留痕(脚本写)
  .gate.json                     # 门禁留痕(通过时写)
  assets/
    01-clear.webp                # 1440×900 浅色截图
    ...
```