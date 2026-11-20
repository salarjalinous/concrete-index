#!/bin/sh
# Re-subsets the self-hosted fonts to keep them inside the 110 KB budget
# (PRD 12.1; tools/check.mjs enforces it). Run after `node tools/vendor.mjs --fonts`.
# Needs Python fonttools and brotli (pip install fonttools brotli).
#
# Keeps every code point in the fontsource "latin" unicode-range (tokens.css
# declares the same range), so no glyph a page can show is dropped. Saves
# bytes by removing TrueType hinting, glyph names, unused OpenType features
# (keeps kern, liga, calt, ccmp, locl, mark, mkmk, tnum), and the VDMX, STAT,
# and BASE tables. Name IDs 0 and 13 to 14 (copyright, OFL notice) are kept.
set -e
cd "$(dirname "$0")/../assets/fonts"
for f in *.woff2; do
  python3 -m fontTools.subset "$f" \
    --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' \
    --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk,tnum' \
    --no-hinting --desubroutinize --no-glyph-names \
    --name-IDs='0,1,2,3,4,5,6,13,14' --drop-tables+=VDMX,STAT,BASE \
    --flavor=woff2 --output-file="$f.tmp"
  mv "$f.tmp" "$f"
done
ls -l *.woff2
