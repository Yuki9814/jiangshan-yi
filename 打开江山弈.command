#!/bin/zsh
# 全部资源已在本文件夹；使用本机已有 Python 3，无第三方依赖。
APP_DIR="${0:A:h}"
if ! command -v python3 >/dev/null 2>&1; then
  print "本机未找到 Python 3。也可用已有的静态网页服务器打开本文件夹。"
  read "?按回车关闭"
  exit 1
fi
exec python3 "$APP_DIR/launcher.py"
