#!/usr/bin/env bash
# 用法：scripts/check-video.sh <视频文件> [更多文件...]
# 检查网页/手机能否顺畅播放：视频流是否 H.264、音频是否 AAC、MP4 是否 faststart（moov 在文件头）。
# 依赖 ffprobe（apt install ffmpeg）。只读，不修改文件。
[ $# -ge 1 ] || { echo "用法：$0 <视频文件> [...]"; exit 2; }
command -v ffprobe >/dev/null || { echo "未找到 ffprobe，请先安装 ffmpeg"; exit 2; }
bad=0
for f in "$@"; do
  [ -f "$f" ] || { echo "$f: 文件不存在"; bad=1; continue; }
  vc=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$f")
  ac=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$f")
  first=$(ffprobe -v trace "$f" 2>&1 | grep -m1 -oE "type:'(moov|mdat)'" | grep -oE "moov|mdat")
  fast=是; [ -z "$first" ] && fast=不适用; [ "$first" = "mdat" ] && fast=否
  echo "$f: 视频=${vc:-无} 音频=${ac:-无} faststart=$fast"
  fix=0
  [ "$vc" = "h264" ] || { echo "  ✗ 视频不是 H.264（H.265/VP9/AV1 在手机浏览器里常见黑屏或无法播放）"; fix=1; }
  [ -z "$ac" ] || [ "$ac" = "aac" ] || { echo "  ✗ 音频不是 AAC"; fix=1; }
  [ "$fast" != "否" ] || { echo "  ✗ moov 在文件末尾，手机要下载完整个文件才开始播放（长时间转圈）"; fix=1; }
  if [ $fix = 1 ]; then
    bad=1
    echo "  修复：ffmpeg -i \"$f\" -c:v libx264 -profile:v high -pix_fmt yuv420p -c:a aac -movflags +faststart out.mp4"
  else
    echo "  ✓ 编码与结构都没问题"
  fi
done
exit $bad
