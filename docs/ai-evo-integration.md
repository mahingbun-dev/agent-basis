# ai-evo 平台对接文档(T7)

> 探活日期:2026-11-03。结论:**平台 http://MaNas:8201 可达、LiteLLM 网关 http://MaNas:4000 可达(需 Key)、aievo-cli 未安装、平台当前 `AIEVO_DEMO_MODE=true` 演示态**——正式对接必须先完成 §2 手动步骤(注册/建 Key/退 demo 属用户人工操作,设计文档 14 号 §5 明确划在用户侧),本文件即操作手册。
>
> 事实来源(全部为当次实测或直读,非转述):①§1 探活命令在本机实际执行;②Synology 部署文件 `/data/ai-evo/compose.35288cc.yml`、`compose_up.sh` 与运行容器;③平台 `GET /openapi.json`(FastAPI "AI Evaluation Platform 1.0.0")与镜像 `ai-evo:pr1` 内源码 `/app/app/`;④aievo-cli 源码仓 `/data/ai-evo/repo/cli/README.md`;⑤LiteLLM 配置 `/data/litellm/litellm_config.yaml`;⑥T6 金集产物 `packs/event-planning/evals/`;⑦设计文档 06/07/10/13/14 号。文中不出现任何密钥明文(位置均已标注)。

---

## 1. 连通性结论与探活命令

| 目标 | 探活命令(本机直接可复跑) | 实测结果(2026-11-03) | 结论 |
|---|---|---|---|
| ai-evo 平台 | `curl -sS -o /dev/null -w "%{http_code}" http://MaNas:8201/` | `200`(0.019s;页面 `<title>模型评测平台</title>`,Vue SPA) | ✅ 可达 |
| ai-evo API 面 | `curl -sS http://MaNas:8201/api/v1/health` | `200`;`curl http://MaNas:8201/openapi.json` 返回完整 OpenAPI 3.1 文档 | ✅ API 存活 |
| LiteLLM 网关 | `curl -sS -o /dev/null -w "%{http_code}" http://MaNas:4000/health` | `401`,响应体 `{"error":{"message":"Authentication Error, No api key passed in.","type":"auth_error","code":"401"}}`;`/` 返回 LiteLLM Swagger UI,`/v1/models` 同为 `401` | ✅ 可达(服务在线,**必须带 Key** 才能进一步验证) |
| aievo-cli | `command -v aievo-cli aievo` | 均未找到(exit 1) | ❌ 未安装(安装见 §3) |

> 探活判定口径:HTTP 200/401 都证明服务在线(401=在线但需鉴权);连接超时/拒绝才判不可达。带 Key 的网关连通性验证并入 §2 M4(需先取到 LiteLLM Key)。

**部署形态**(Synology `container_list` 实测,全部 running):`ai-evo-api` / `ai-evo-worker`(镜像 `ai-evo:pr1`)、`ai-evo-executor`、`ai-evo-postgres`(host 网,15433)、`ai-evo-redis`、`litellm-gateway`(v1.96.5,host 网 4000)。生效 compose 为 `/data/ai-evo/compose.35288cc.yml`(`compose_up.sh` 实际执行 `docker compose -p repo -f /data/ai-evo/compose.35288cc.yml up -d`)。

---

## 2. 手动对接步骤清单(必须由用户完成)

> 顺序敏感:M1(退 demo)必须先于 M4(配模型)与 M6(建任务),否则模型调用打到 mock、门禁分数无意义。

### M1 退 demo(管理员,NAS 上操作)——先决条件

现状证据:容器 `ai-evo-api` 内 `env` 实测含 `AIEVO_DEMO_MODE=true` 与 `AIEVO_DEMO_MOCK_BASE_URL=http://127.0.0.1:8201`;来源是 `/data/ai-evo/compose.35288cc.yml` 中 `api:` 与 `worker:` 两个 service 的 `environment:` 各两行。demo 态的危害:demo 种子数据会把**模型配置写成指向平台内置 mock LLM(`demo_seed_service.py` 中 `api_key="aievo-demo-mock"`,端点指回 8201 自身)**,评测分数来自假模型。

操作:
1. SSH 上 NAS,编辑 `/data/ai-evo/compose.35288cc.yml`:删去或改掉 `api:` 与 `worker:` 下的 `- AIEVO_DEMO_MODE=true` 与 `- AIEVO_DEMO_MOCK_BASE_URL=...` 两行(共 4 行)。
   备选:同目录 `compose.pr1.yml` 是**去掉 demo 开关**的等价版本(NAS 上 `diff` 实测:两文件仅差 api/worker 各 2 行 `AIEVO_DEMO_*` 环境变量,共 4 行),把 `compose_up.sh` 里的文件名换成它再执行亦可。
2. 重建:`docker compose -p repo -f /data/ai-evo/compose.35288cc.yml up -d`(仅 api/worker 会重建,postgres/redis 不动)。
3. 验证:`docker exec ai-evo-api sh -c 'env | grep DEMO'` 应无输出;`docker logs ai-evo-api --tail 50` 不再出现 `[demo] AIEVO_DEMO_MODE=true：当前以演示模式运行` 横幅(横幅文案见镜像内 `/app/app/core/config.py:447`)。
4. 善后(建议):平台 UI 里检查「模型配置」,删除 demo 种子的 mock 模型条目(识别特征:api_key 为 `aievo-demo-mock`、端点指向 8201 自身);demo 种子数据集/任务(如有)按需清理,避免污染统计。

### M2 注册平台账号(任意成员)

`AUTH_REGISTER_ENABLED=true`(compose 环境实测),自助注册:浏览器开 `http://MaNas:8201` → 注册入口(`POST /api/v1/auth/register`,openapi 实测存在)→ 用常用邮箱+强密码建号。首个账号按平台惯例获得管理侧权限,后续成员同法注册或由管理员邀请。

### M3 开发者设置建 API Key

UI 路径:登录 → **开发者设置 → API Keys → 创建**(对应 `POST /api/v1/api-keys`)。scope 勾选(名称以镜像 `/app/app/core/scopes.py:27-31` 为准,平台共 6 个 scope):

| scope | 用途 | 必须? |
|---|---|---|
| `tasks:run` | 触发评测任务执行(`POST /evaluation/tasks/{id}/run`) | ✅ 必须 |
| `tasks:read` | 读任务状态/执行历史/**门禁结果** | ✅ 必须 |
| `datasets:write` | 上传/写数据集 | ✅ 必须 |
| `results:read` | 读行级结果与导出(`aievo results` 需要) | 建议(否则 CLI 读不了结果) |

创建后 Key 只显示一次(`aievo_sk_` 前缀),立即抄存进密码管理器。

### M4 模型配置:被测与裁判模型指向 http://MaNas:4000(OpenAI 兼容)

> 前提:M1 已退 demo。LiteLLM 网关鉴权 Key = `/data/litellm/.env` 中的 `LITELLM_MASTER_KEY`(值不在本文出现,管理员自查)。网关后端可用模型清单(读 `/data/litellm/litellm_config.yaml` 实测):`deepseek-flash`、`mimo-v2.6-flash`、`mimo-v2.6-pro`、`mimo-v2.6-pro-ultraspeed`、`glm-5.3`、`glm-5.3-flash`。

1. **被测模型**(模型配置 → 新建,对应 `POST /api/v1/models`,字段名取自 openapi schema):`provider=openai`(OpenAI 兼容)、`endpoint=http://MaNas:4000/v1`、`api_key=<LITELLM_MASTER_KEY>`、模型名 `deepseek-flash`(07 号文档 §4 约定:被测 = DeepSeek Flash/Pro 经网关 OpenAI 兼容接入)。保存后点「测试」(`POST /api/v1/models/{model_id}/test`)应通。
2. **裁判模型**(裁判模型 → 新建,对应 `POST /api/v1/judge-models`,字段同上):同样 `provider=openai`、`endpoint=http://MaNas:4000/v1`、`api_key=<LITELLM_MASTER_KEY>`,建议 `glm-5.3`(裁判用强模型,与被测异源防同源偏置;备选 `mimo-v2.6-pro`)。裁判治理(快照/消毒/金丝雀)平台已内置,保持默认开启(07 号 §2)。
3. 平台容器为 host 网络,写 `http://MaNas:4000/v1` 或 `http://127.0.0.1:4000/v1` 均可达;对外文档统一用 `MaNas` 主机名。
4. 验证:`curl -sS -H "Authorization: Bearer <LITELLM_MASTER_KEY>" http://MaNas:4000/v1/models` 返回模型清单(不带 Key 是 401,见 §1)。

### M5 上传 packs/event-planning 金集数据集

产物:`packs/event-planning/evals/export/ai-evo-goldenset-v1.csv`(T6 生成,30 条,列 `user_input,answer,id,tags,category,red_line`,UTF-8 BOM + CRLF + RFC4180 引号转义,Excel 兼容)。

- **平台 UI 直传 CSV**:数据集 → 导入,选该 CSV。平台导入管道接受 `.xlsx/.xls/.csv`(镜像 `/app/app/api/dataset_api.py:1698` 实测映射)。标准字段 `user_input`/`answer`,其余列按扩展字段入库(上限 20 列,支持中文列名,07 号 §2);本 CSV 共 4 个扩展列,远低于上限。
- **走 aievo-cli 则必须 .xlsx**(CLI 只吃 `.json/.xlsx/.xls`,见 §3):仓库已带转换好的 `ai-evo-goldenset-v1.xlsx`(见 §4),亦可自行重转。
- 建集名:`event-planning-goldenset-v1`。上传后核对行数=30、`red_line=true` 恰 3 条。

### M6 建三个门禁任务(release / admission / heldout)

> 拆分口径:10 号文档 `dsh-evolve` §配置——`tasks: { release: "task-release-gate", admission: "task-admission-gate", heldout: "task-heldout-gate" }`;admission=防刷分的第一道独立样本(canary 标记),heldout=终审、Phase1 从 golden 留出 20%(10 号 138-139 行)。

对同一数据集建 3 个任务(评测任务 → 新建,`POST /api/v1/evaluation/tasks`,openapi 实测含 `gate_config`/`verifiers`/`trajectory_config` 字段),按下表圈数据:

| 任务 | 数据范围(30 条金集) | 用途 |
|---|---|---|
| `task-release-gate` | 18 条(60%) | 日常回归主门禁:每次 pack/skill/persona 改动后必跑 |
| `task-admission-gate` | 6 条(20%,打 canary 标记) | 准入独立样本:防对着 release 集刷分 |
| `task-heldout-gate` | 6 条(20%,留出) | 终审 held-out:**不参与日常迭代**,季度轮换(10 号:heldout 目标 ≥30 条/季,v0 先按 20% 留出) |

- 圈数据实现:上传后用平台数据集行筛选(按 `id`/`tags` 列)分三次导出子数据集,或按 `id` 前缀分段;**切分清单要落盘**(建议提交到 `packs/event-planning/evals/split-v1.txt`,保证可复现、可审计)。
- 内环 smoke 子集(9 条,`tags` 含 `smoke`)是 release 集的子集,本地 `dsh-evals` 用,不单独建平台任务(threshold.yml:2)。
- 轨迹断言:任务配置里启用轨迹匹配(`trajectory_config`),聚合出 `trajectory_match_rate` 接门禁(镜像 `/app/app/models/task_models.py:176-178`);终态校验启用 `verifiers`。断言语义与本地 golden YAML 同构(07 号 §3.2),双轨一致。

### M7 门禁阈值建议(校验通过率 / 轨迹匹配率)

metric 键名以镜像 `/app/app/services/gate_service.py:15,22-25` 为准:`pass_rate`(别名 `success_rate`)、`verification_pass_rate`(终态校验器行通过率)、`trajectory_match_rate`;判定方式选**全部通过(all)**。阈值与 T6 `packs/event-planning/evals/threshold.yml:7-10` 同源:

| 任务 | verification_pass_rate | trajectory_match_rate | judge 平均分 | 备注 |
|---|---|---|---|---|
| release | **≥ 0.85** | **≥ 0.80** | ≥ 4.0(满分 5) | 日常回归线(threshold.yml 原值) |
| admission | ≥ 0.85 | ≥ 0.80 | ≥ 4.0 | 独立样本,阈值不低于 release,防刷分 |
| heldout | ≥ 0.85 | ≥ 0.80 | ≥ 4.0 | 终审同线;季度轮换时重校准 |

- **审批红线零容错**:3 条 `red_line=true` 案例(超支 15% 必 R3 / 对外付款必升级 / 比选必中立)建议在门禁里单列检查项或从数据集维度单独断言:红线行任一失败即整任务判 failed(红线=安全属性,不参与比率平均)。实现:红线 3 条单独建 `task-redline-gate`(阈值 `verification_pass_rate ≥ 1.0`),或门禁 all 模式下靠行级必过约束。
- 首跑校准:第一轮可先跑出基线再挂门禁(平台门禁可后配);**若基线达不到 0.85,修 pack 而不是降阈值**——0.85 是验收线;下限参考 06 号 SOP「终态校验通过率 ≥80% 才进 S2」。全阈值通过 + 报告归档是发布 DoD(06 号:80)。
- 缓存命中率 `cache_hit_rate_min: 0.7`(threshold.yml:11)是工程指标,建议放本地观测(@eterna/observe)而非平台门禁,避免网关抖动误伤发布。

### M8 安装 aievo-cli 并首跑验证(开发机)

见 §3。装好 → `aievo config add` → `aievo run task-release-gate --wait --json`,exit 0 即闭环打通。

---

## 3. aievo-cli 用法示例与退出码语义

> 来源:aievo-cli 源码仓 `/data/ai-evo/repo/cli/README.md`(当次直读,命令与退出码逐字核对)。Python 包,依赖 `typer + httpx`。

### 安装(三通道,按可得性降级)

```bash
pip install aievo-cli        # ① PyPI(发布后可用;当前探活未安装,先试这条)
pip install "aievo-cli @ git+https://github.com/mahingbun-dev/ai-evo#subdirectory=cli"
                              # ② git 直装(PyPI 未发布/私有网络)
pip install -e /data/ai-evo/repo/cli/   # ③ 源码开发安装(NAS 上源码已就位)
```

### 常用命令

```bash
# 1. 保存平台地址与 API Key(Key 来自 §2 M3,需 tasks:run + tasks:read)
aievo config add http://MaNas:8201 aievo_sk_xxxx
#   配置落 ~/.aievo/config.toml(权限 0600);--profile 多环境;AIEVO_PROFILE 切换;aievo config list 查看(Key 打码)

# 2. 触发评测并等待门禁判定(CI 主命令)
aievo run task-release-gate --wait --timeout 7200 --json
#   触发 POST /api/v1/evaluation/tasks/{id}/run(tasks:run);--wait 轮询 GET .../gate(tasks:read);
#   --json 时 stdout 只输出单 JSON 对象(verdict/checks/gate_result 机读),人类可读进度走 stderr

# 3. 读取结果
aievo results task-release-gate -o json    # 完整结果对象
aievo results task-release-gate -o csv     # 行级明细(idx/success/row_status/average_score/feedback)

# 4. 上传数据集(需 datasets:write;.json 走 JSON 导入,.xlsx/.xls 走 Excel 导入;CSV 需先转,见 §4)
aievo datasets upload ./ai-evo-goldenset-v1.xlsx --name event-planning-goldenset-v1
```

### 退出码矩阵(`aievo run --wait`)——CI 卡发布语义

| 场景 | 退出码 |
|---|---|
| 门禁判定 `passed`(所有阈值达标) | **0** |
| 门禁判定 `failed`(质量不达标) | **1** |
| 门禁判定 `error`(指标不可用等) | 2 |
| 等待超时(`--timeout` 秒内未出判定) | 2 |
| 任务 failed/stopped 收尾且无判定 | 2 |
| 任务未启用门禁(gate_config 为空) | 2 |
| 认证失败(Key 无效/吊销)、scope 不足、网络错误 | 2 |
| 不带 `--wait`:触发成功即退出 | 0 |

CI 集成语义:**0=放行发布,1=质量拒绝(要修 pack),2=基础设施异常(要查平台/网络,不算质量结论)**。GitHub Actions / GitLab / Jenkins 模板在源码仓 `ci-templates/`。

---

## 4. 金集 CSV → Excel 转换说明

**何时需要转**:平台 UI 导入管道直接接受 `.csv`(`dataset_api.py:1698`),UI 上传**无需**转换;`aievo datasets upload` 只认 `.json/.xlsx/.xls`,**走 CLI 必须转 `.xlsx`**。转换需保证多行单元格(`user_input` 内含换行)不丢、中文不乱码。

**已经替你转好**:`packs/event-planning/evals/export/ai-evo-goldenset-v1.xlsx` 即按下方方法 B 生成并核验过的成品(2026-11-03 实测:31 行=表头+30 数据、`red_line=true` 恰 3 行、zip 完整性通过),CLI 上传可直接用它;下述方法留给金集更新后重生成用。

**源文件形态**(T6 生成器 `packs/event-planning/evals/export/generate-csv.mjs` 保证):UTF-8 带 BOM + CRLF 行尾 + RFC4180 引号转义——这正是 Excel 双击直开不乱码的形态。

方法 A(图形界面,零依赖,推荐一次性手工):
1. Excel / WPS / Numbers 双击打开 `ai-evo-goldenset-v1.csv`(BOM 保证 UTF-8 识别);
2. 核对首行表头 `user_input, answer, id, tags, category, red_line`,数据 30 行,`user_input` 列多行文本完整;
3. 另存为 → 文件类型选 **Excel 工作簿 (*.xlsx)** → 存为 `ai-evo-goldenset-v1.xlsx`。

方法 B(命令行,可脚本化,Mac 自带 python3):
```bash
python3 -c "
import csv
try:
    import openpyxl
except ImportError:
    raise SystemExit('请先 pip install openpyxl')
with open('packs/event-planning/evals/export/ai-evo-goldenset-v1.csv', encoding='utf-8-sig', newline='') as f:
    rows = list(csv.reader(f))
wb = openpyxl.Workbook(); ws = wb.active
for r in rows: ws.append(r)
wb.save('packs/event-planning/evals/export/ai-evo-goldenset-v1.xlsx')
print('rows=', len(rows))
"
```

转换后自检清单:
- [ ] 行数 = 31(表头 1 + 数据 30);
- [ ] `id` 列无科学计数法/截断(纯文本列);
- [ ] 任选一条多行 `user_input` 与 YAML 原文比对完整;
- [ ] `red_line=true` 恰 3 行;
- [ ] 扩展列共 4 个(`id/tags/category/red_line`),未超平台 20 扩展列上限。

> 注意:**不要**在 Excel 里做排序/去重/合并单元格再上传——行序是 `id` 与 golden YAML 关联回灌的键(T6 export README「回灌」节),乱序会导致失败案例对不上源 case。

---

## 5. 用户完成后的核对表(对接验收)

| # | 步骤 | 验证方式 | 预期 |
|---|---|---|---|
| M1 | 退 demo | `docker exec ai-evo-api sh -c 'env \| grep DEMO'` | 无输出 |
| M2/M3 | 账号+Key | `aievo config add http://MaNas:8201 aievo_sk_...` 后任读操作 | 不报 401 |
| M4 | 模型指向 litellm | 平台「测试」按钮 / `curl -H "Authorization: Bearer <KEY>" http://MaNas:4000/v1/models` | 模型清单返回 |
| M5 | 金集上传 | 数据集详情 | 30 行、red_line 3 条 |
| M6/M7 | 三门禁任务+阈值 | 任务详情 gate_config | 18/6/6、阈值如表 |
| M8 | CLI 首跑 | `aievo run task-release-gate --wait --json; echo $?` | 0(或 1=首跑未达标,修 pack) |

## 6. 本次未覆盖(后置联调,不阻塞)

- 本文所有平台操作均为**文档产出**,未替用户执行注册/建 Key/退 demo/建任务(14 号 §5 划归用户侧;退 demo 涉及 NAS 生产容器重建)。
- aievo-cli 未在本机安装实测(PyPI 发布状态未验证),§3 命令形态源自源码仓 README;装好后如有参数漂移,以 `aievo --help` 为准。
- 门禁判定真跑(verification_pass_rate / trajectory_match_rate 实际产出)依赖 M1-M7 完成,属运行时联调,列入 T14 总装验收范围。

## 7. 平台侧线冗余降级记录(T5,2026-11-04)

> 背景:另一会话曾建 25/6 两个侧线数据集,与主线 12/4/4 三数据集(release/admission/heldout v1)内容重复。**不物理删除**,改名降级保留可追溯(设计文档 18 号 §6 第 5 项)。

实测操作(全部 JWT 鉴权,`GET/PUT /api/v1/evaluation/datasets[.../{id}]`):

| 数据集 id | 原名 | 行数 | 降级后 name | description 追加 |
|---|---|---|---|---|
| `ds_e6ef85b4c3db` | 活动策划金集v1-main | 25 | `[deprecated-侧线冗余] 活动策划金集v1-main` | T5 降级标注(侧线冗余,未删除) |
| `ds_df13514fe2c4` | 活动策划金集v1-heldout | 6 | `[deprecated-侧线冗余] 活动策划金集v1-heldout` | 同上 |

改名后全量列表复核(PUT 200 + GET 断言 17 项全过):

- **主线三件套完好未动**:`ds_1e9470dbe7f4` event-goldenset-release-v1(12)/`ds_facebc33b2af` admission-v1(4)/`ds_24c9051325b7` heldout-v1(4),name 与 question_count 均未变;三门禁任务绑定关系不变(release=completed,admission/heldout=pending)。
- **两个侧线数据行数不变**(25/6,PUT 仅触及 name/description,openapi `UpdateDatasetRequest` 实测仅此二字段)。
- 同场其余数据集(demo 种子 `demo-dataset-001`、平台早期 `ds_5ca3a7cf59ef` 回归测试问答集)非本项目产物,未动。
- **agentbasis_qa 账号未动**(按任务约定):openapi 实测无删除用户端点;禁用面为 `PATCH /api/v1/teams/{team_code}/members/{user_code}/status`(body `{"is_active": false}`,**仅超管可用**),属平台管理侧操作,留用户执行(UI 或超管凭证调用)。
