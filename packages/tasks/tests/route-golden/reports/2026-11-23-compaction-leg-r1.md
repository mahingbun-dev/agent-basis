# 路由金集压缩态回放报告(G2-A9;28 号 §5)

- 生成:2026-11-23T02:50:23.600Z;模型:deepseek-flash;阈值:2pp
- 判例:20 条(双腿 19 + byGate 单列 1:RG-16)
- 干净态通过率:94.7%;压缩态通过率:94.7%;差值:0.0pp
- 结论:无衰减(≤阈值)

## 逐条裁决

| 判例 | 记录 | 干净态 | 压缩态 |
|---|---|---|---|
| RG-01 | accept | accept | accept |
| RG-02 | accept | accept | accept |
| RG-03 | accept | accept | accept |
| RG-04 | accept | accept | accept |
| RG-05 | accept | accept | accept |
| RG-06 | accept | accept | accept |
| RG-07 | attach | attach | attach |
| RG-08 | attach | attach | attach |
| RG-09 | attach | attach | attach |
| RG-10 | attach | accept ✗ | accept ✗ |
| RG-11 | attach | attach | attach |
| RG-12 | ignore-bot | ignore-bot | ignore-bot |
| RG-13 | ignore-bot | ignore-bot | ignore-bot |
| RG-14 | ignore-bot | ignore-bot | ignore-bot |
| RG-15 | ignore-bot | ignore-bot | ignore-bot |
| RG-17 | stop | stop | stop |
| RG-18 | stop | stop | stop |
| RG-19 | stop | stop | stop |
| RG-20 | stop | stop | stop |

## 压缩摘要样例(前 2 条)

### RG-01

此前会话无活跃工单与未决事项。

### RG-02

此前会话无活跃工单与未决事项。

## 边界登记

v0 会话历史为判例字段确定性派生的合成转录;真实 audit trace 灌入随 24a C4 扩展(见脚本文件头)。