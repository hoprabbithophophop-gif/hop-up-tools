#!/bin/sh
# 撮った webm を X に載せられる mp4 にする（H.264・30コマ・2倍に拡大して 780×1688・音なし）
# 使い方: sh scripts/demo-video/to-mp4.sh <入力.webm> <出力.mp4>
ffmpeg -y -v error -i "$1" -vf "fps=30,scale=780:1688:flags=lanczos" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -an "$2"
