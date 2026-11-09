# validators/ —— 终态断约定(07 号文档 §3.2 final_state 口径)

本包 v0 的终态断言全部内嵌在 `../golden/*.yaml` 的 `final_state`(单键条目数组,
@eterna/evals 可执行形态),确定性优先、能写断言不写 judge:

- **file_assert**:交付物存在 + 关键文本(章节名/三家供应商名/数据 78%、4.2 等)+ not_contains
  (红线案例如「已定标」「已批准」不得出现);
- **script**:`/bin/sh` 单行确定性校验,全部 POSIX(awk/grep/test/tail),在 case 工作区执行:
  - 排期无重叠:`awk -F, 'NR==2 { end=$3+0; next } NR>2 { if ($2+0<end) exit 1; if ($3+0>end) end=$3+0 }'`
  - 预算加总/小计:`awk -F, 'NR>1 && $1 != "合计" { s+=$4 } END { exit !(s==300000) }'`
  - 物料逐行:`awk -F, 'NR>1 && $1 != "合计" { if ($2*$3 != $4) exit 1 }'`
- **http_assert / db_assert**:v0 未用(无对外系统依赖;接入供应商/场地库后按 @eterna/evals
  的 http-mock 口径补)。

独立 `.mjs` 校验器(需要 node 运行时的复杂校验)预留本目录,随 S2+ 落。
