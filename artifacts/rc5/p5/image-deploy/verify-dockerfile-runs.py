#!/usr/bin/env python3
"""Dockerfile RUN 指令 shell 语法静态检查(P5 T40/T41 证据;不 build 镜像)。

做法:按 BuildKit 的解析语义拼接续行(以 `#` 开头的注释行在拼接前剔除),
对每条 RUN 的命令体跑 `dash -n -c`(Debian 基础镜像的默认 /bin/sh)。
用途:在没有 docker build 的 lane 里抓住引号/here-doc/`&&` 链断裂这类构建期才会炸的错。

用法: python3 verify-dockerfile-runs.py <Dockerfile>
退出码: 0 全部 RUN 语法通过;1 有失败。
"""
import pathlib
import subprocess
import sys


def main() -> int:
    target = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "Dockerfile")
    instructions: list[str] = []
    buf = ""
    for raw in target.read_text().splitlines():
        line = raw.rstrip()
        if line.lstrip().startswith("#"):  # BuildKit: 注释行在指令拼接前剔除
            continue
        if not buf and line.strip() == "":
            continue
        if line.endswith("\\"):
            buf += line[:-1] + " "
            continue
        buf += line
        instructions.append(buf.strip())
        buf = ""
    if buf.strip():
        instructions.append(buf.strip())

    runs = [i for i in instructions if i.startswith("RUN ")]
    print(f"{target}: instructions={len(instructions)} RUNs={len(runs)}")
    failed = 0
    for idx, run in enumerate(runs, 1):
        proc = subprocess.run(["/bin/dash", "-n", "-c", run[4:]], capture_output=True, text=True)
        ok = proc.returncode == 0
        print(f"RUN#{idx}: {'OK' if ok else 'FAIL'}")
        if not ok:
            failed += 1
            print("  stderr:", proc.stderr.strip().splitlines()[:3])
    print(f"FAILED_RUNS={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())