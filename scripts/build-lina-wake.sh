#!/usr/bin/env bash
# Builds "Hey Lina" for the Windows desktop app: src-tauri/lina/lina-wake.c → src-tauri/lina/bin/ (exe, sherpa-onnx +
# onnxruntime DLLs, the keyword model and android/app/lina/keywords.txt). The Tauri bundle ships that folder.
# Needs MinGW gcc (MSYS2). Downloads are pinned by SHA-256 and kept in src-tauri/lina/vendor (gitignored).
# Usage: bash scripts/build-lina-wake.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LINA="$ROOT/src-tauri/lina"
VENDOR="$LINA/vendor"
OUT="$LINA/bin"
SHERPA=1.13.8
PKG="sherpa-onnx-v$SHERPA-win-x64-shared-MT-MinSizeRel-no-tts"
MODEL="sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
mkdir -p "$VENDOR" "$OUT/kws"

fetch() {  # url file sha256
  local f="$VENDOR/$2"
  if [ -f "$f" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$3" ]; then return; fi
  echo "lina: downloading $1"
  curl -fsSL -o "$f.part" "$1"
  [ "$(sha256sum "$f.part" | cut -d' ' -f1)" = "$3" ] || { rm -f "$f.part"; echo "lina: checksum mismatch for $1" >&2; exit 1; }
  mv "$f.part" "$f"
}
fetch "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA/$PKG.tar.bz2" "$PKG.tar.bz2" a0ec3b679b6da3da5d79b398b0ed696e19c594c9f26ab03e6ce551ac4e55f9a4
fetch "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$MODEL.tar.bz2" "$MODEL.tar.bz2" f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a

[ -d "$VENDOR/$PKG" ] || tar -xjf "$VENDOR/$PKG.tar.bz2" -C "$VENDOR"
M="-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
for f in "encoder$M" "decoder$M" "joiner$M" tokens.txt; do
  [ -f "$OUT/kws/$f" ] || tar -xjf "$VENDOR/$MODEL.tar.bz2" -C "$OUT/kws" --strip-components=1 "$MODEL/$f"
done
cp "$ROOT/android/app/lina/keywords.txt" "$OUT/kws/"
for d in sherpa-onnx-c-api.dll onnxruntime.dll onnxruntime_providers_shared.dll; do cp "$VENDOR/$PKG/lib/$d" "$OUT/"; done

# -static: no MinGW runtime DLLs to ship; -mwindows would hide stderr, the app starts it without a console anyway.
gcc -O2 -std=c11 -Wall -static -o "$OUT/lina-wake.exe" "$LINA/lina-wake.c" \
  -I "$VENDOR/$PKG/include" "$VENDOR/$PKG/lib/sherpa-onnx-c-api.dll" -lwinmm
echo "lina: built $OUT/lina-wake.exe"
