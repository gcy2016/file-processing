#!/usr/bin/env bash
# 下载 python-can 及其纯 Python 依赖的 wheel 到 tools/wheels/（BLF 转文本用）
# wrapt 只在 ThreadSafeBus 里可选导入，读写日志文件用不到，所以不带
set -euo pipefail
cd "$(dirname "$0")"
rm -rf wheels && mkdir wheels
pip download --no-deps -q -d wheels "python-can==4.6.1" "packaging==26.3" "typing_extensions==4.16.0"
ls wheels
