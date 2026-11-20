# RC5-DATA-001 · 新宿主目录初始化（init-data-dirs）

- 依据：51 §3.14 DATA-001；48 §6.4 / §9 / §10
- 执行：2026-11-19T22:06Z 左右（宿主 macOS arm64，Docker 29.7.2）
- 环境：测试根半区 `$HOME/eterna-data/test-rc5/.p6b-data001/root`（未触生产根；生产仍为 named volume）

## 命令（原文见 `cmd.log`）

```bash
ETERNA_DATA_ROOT=$HOME/eterna-data/test-rc5/.p6b-data001/root bash deploy/init-data-dirs.sh probe   # 第 1 次
ETERNA_DATA_ROOT=$HOME/eterna-data/test-rc5/.p6b-data001/root bash deploy/init-data-dirs.sh probe   # 第 2 次（幂等）
```

负控（4 条，均预期非 0）：相对路径根、符号链接根、`../evil` 实例名、git 工作树内根。

## 断言（11/11 PASS）

| 断言 | 实测 |
|---|---|
| 根目录 0700 | 700 |
| 实例根 0700 | 700 |
| backups / exports 0700 | 700 / 700 |
| 子目录齐全（16 个，逐字取 `deploy/init-data-dirs.sh:69` SUBDIRS） | 全部存在 |
| 子目录权限均 0700 | 全部 700 |
| 二次执行树快照一致（路径+权限+inode） | identical（`tree-run1.txt` vs `tree-run2.txt`，各 20 行：根 + backups/exports/实例根 + 16 子目录） |
| 负控-相对路径 | rejected（EXIT≠0） |
| 负控-符号链接根 | rejected |
| 负控-越界实例名 | rejected |
| 负控-git 工作树内 | rejected，且未创建目录 |

## 结论

**PASS**。脚本幂等、权限收紧到 0700、子目录面与源码 SUBDIRS 一致；四条破坏性输入全部 fail-closed。