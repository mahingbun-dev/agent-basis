# ai-evo 上传导出(13 号文档 §5 第 4 步)

## 产物

- `ai-evo-goldenset-v1.csv` —— 30 条 golden 的上传用导出(Excel 兼容:UTF-8 BOM + CRLF + RFC4180 引号转义);
- `generate-csv.mjs` —— 生成器:读 `../golden/*.yaml`(复用 @basis/packctl 的 loadGoldenDir,
  与 packctl lint / @basis/evals loader 同一份解析器),answer 列由终态/轨迹断言确定性派生。

## 列口径(user_input / answer / 扩展列)

| 列 | 说明 |
|---|---|
| `user_input` | 任务输入(与 golden YAML 同文) |
| `answer` | 验收要点:由 final_state + trajectory 断言确定性派生(本地无裁判模型;创意类 rubric 留平台 judge) |
| `id` | golden id(= YAML 文件名 stem;回灌与轨迹关联键) |
| `tags` | `\|` 分隔(类目 + smoke) |
| `category` | 13 号文档 §2 十类候选之一 |
| `red_line` | `true` = 审批红线案例(共 3 条:超支 15% 必 R3 / 对外付款必升级 / 比选必中立) |

## 重新生成

```sh
# 仓库根(agent-basis/),Node >= 22.18
node packs/event-planning/evals/export/generate-csv.mjs
```

## 上传步骤(13 号文档 §5 第 4 步;平台探活与建 Key 属 T7,此处只列操作)

1. **前置(一次性,人工)**:ai-evo 平台 `http://<NAS-IP>:8201` 注册账号
   (AUTH_REGISTER_ENABLED=true 自助)→ 创建 API Key(权限 `tasks:run/read` + `datasets:write`);
   ⚠️ 平台「模型配置」当前可能仍是 `AIEVO_DEMO_MODE=true`(litellm 网关 `http://<NAS-IP>:4000`
   指向 demo/mock)——**上传前必须先在平台把被测/裁判模型指向真实端点**,否则 judge 打分来自 mock。
2. **上传数据集**:平台 UI「数据集 → 导入 CSV」选本文件;或 aievo-cli:
   `aievo datasets upload --file ai-evo-goldenset-v1.csv --name event-planning-goldenset-v1`。
3. **建门禁任务**:对数据集建任务,阈值对齐 `../threshold.yml`
   (release:verification_pass_rate_min 0.85 / trajectory_match_rate_min 0.8 / judge_score_min 4.0);
   smoke 子集按 `smoke` tag 跑。
4. **回灌**:跑完的会话/失败案例按 `id` 列关联回 `../golden/<id>.yaml` 迭代(S6 循环)。

> 三数据集拆分(训练 / 发布门禁 / held-out 轮换,12 号文档 D3)在 v0 之后做:
> 本 CSV 先作发布门禁数据集;held-out 季度轮换再从金集留出 20%。
