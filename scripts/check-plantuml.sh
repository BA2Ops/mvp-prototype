#!/usr/bin/env bash
# Validate all PlantUML files against the local PlantUML server.
#
# Usage:
#   ./scripts/check-plantuml.sh <base-dir>   # default: docs/mvp/l1-design/02-instructions
#
# Endpoint: http://192.168.3.155:7788/png/<encoded>
#   - HTTP 200 = syntax OK
#   - HTTP 400 = syntax error (response body contains error message)

set -e
BASE="${1:-docs/mvp/l1-design/02-instructions}"
ENDPOINT="http://192.168.3.155:7788/png"
TIMEOUT=10
TMP="C:/Users/ChineseXu/AppData/Local/Temp"
mkdir -p "$TMP"

# Python encoder: reads file, applies plantuml deflate + custom base64
encode_puml() {
  python -c "
import sys, zlib, base64
data = open(r'''$1''', 'rb').read().decode('utf-8')
compressed = zlib.compress(data.encode('utf-8'))[2:-4]
plantuml_b64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
std_b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
b64 = base64.b64encode(compressed).decode('ascii')
trans = str.maketrans(std_b64, plantuml_b64)
print(b64.translate(trans))
"
}

# Collect all .puml files
shopt -s globstar nullglob
mapfile -t PUML_FILES < <(find "$BASE" -name "*.puml" -type f | sort)
TOTAL=${#PUML_FILES[@]}
echo "scanning $TOTAL PlantUML files under $BASE/"
echo ""

PASS=0
FAIL=0
ERRORS=()

for puml in "${PUML_FILES[@]}"; do
  encoded=$(encode_puml "$puml" 2>/dev/null)
  if [ -z "$encoded" ]; then
    echo "[ENCODE-FAIL] $puml"
    FAIL=$((FAIL+1))
    continue
  fi

  status=$(curl -sS -o "$TMP/_pu_check.bin" -w "%{http_code}" --max-time "$TIMEOUT" \
    "${ENDPOINT}/${encoded}" 2>/dev/null)

  size=$(wc -c < "$TMP/_pu_check.bin" 2>/dev/null || echo 0)

  # Try to fetch the SVG variant too — error responses contain "Syntax Error" text
  svg_status=$(curl -sS -o "$TMP/_pu_check.svg" -w "%{http_code}" --max-time "$TIMEOUT" \
    "http://192.168.3.155:7788/svg/${encoded}" 2>/dev/null)

  if grep -qE "Syntax Error|Error line|Error syntax" "$TMP/_pu_check.svg" 2>/dev/null; then
    err_msg=$(grep -oE "Syntax Error[^<\"]*|Error line [0-9]+[^<\"]*" "$TMP/_pu_check.svg" 2>/dev/null | head -1 | cut -c1-120)
    echo "[SYNTAX-ERR] $puml  → $err_msg"
    ERRORS+=("$puml: $err_msg")
    FAIL=$((FAIL+1))
  elif [ "$status" = "200" ]; then
    echo "[OK]         $puml  (${size}B)"
    PASS=$((PASS+1))
  else
    echo "[HTTP-$status]  $puml  (${size}B)"
    FAIL=$((FAIL+1))
  fi
done

echo ""
echo "============================================"
echo "  total: $TOTAL   ok: $PASS   fail: $FAIL"
echo "============================================"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "FAILED FILES:"
  printf '  %s\n' "${ERRORS[@]}"
  exit 1
fi