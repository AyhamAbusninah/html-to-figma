#!/usr/bin/env bash
# Regenerates public/icons/icon-{16,32,48,128}.png (committed). Requires ImageMagick 7 (`magick`).
# Design: brand-blue rounded square with a white "page → layers" mark (an outlined page and two stacked layer bars).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/icons
magick -size 128x128 xc:none \
  -fill '#1f5fbf' -draw 'roundrectangle 4,4 123,123 26,26' \
  -fill none -stroke white -strokewidth 9 -draw 'roundrectangle 30,26 78,90 8,8' \
  -stroke none -fill white -draw 'roundrectangle 58,60 102,74 5,5' \
  -fill '#9cc3ff' -draw 'roundrectangle 58,82 102,96 5,5' \
  -strip public/icons/icon-128.png
for s in 48 32 16; do
  magick public/icons/icon-128.png -filter Lanczos -resize ${s}x${s} -strip public/icons/icon-${s}.png
done
ls -l public/icons
