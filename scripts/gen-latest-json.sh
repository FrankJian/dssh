#!/usr/bin/env bash
#
# 生成 Tauri 自动更新所需的 latest.json。
#
# 在 `pnpm tauri build` 之后运行本脚本，它会：
#   1. 从 src-tauri/Cargo.toml 读取版本号；
#   2. 在 src-tauri/target/release/bundle 下查找当前平台的安装包及其 .sig 签名文件；
#   3. 结合你提供的下载地址前缀，生成 latest.json。
#
# 用法：
#   scripts/gen-latest-json.sh --base-url https://你的域名/dssh [--notes "更新说明"] [--out release/latest.json]
#
# 说明：
#   - --base-url 是安装包所在目录的 HTTPS 前缀，最终下载地址 = <base-url>/<安装包文件名>。
#   - 由于各平台的安装包只能在对应系统上构建，跨平台发布时请在每个系统各运行一次，
#     并把生成结果里的 platforms 条目合并到同一个 latest.json（安装了 jq 时本脚本会自动合并已存在的 latest.json）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle"

BASE_URL=""
NOTES=""
OUT="$ROOT/release/latest.json"
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --notes) NOTES="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --pub-date) PUB_DATE="${2:-}"; shift 2 ;;
    -h|--help)
      grep -E '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

if [[ -z "$BASE_URL" ]]; then
  echo "错误：必须通过 --base-url 提供安装包下载地址前缀。" >&2
  echo "示例：scripts/gen-latest-json.sh --base-url https://downloads.example.com/dssh" >&2
  exit 1
fi
BASE_URL="${BASE_URL%/}"

# 版本号：从 [package] 段读取第一处 version = "x.y.z"
VERSION="$(grep -m1 -E '^version[[:space:]]*=' "$ROOT/src-tauri/Cargo.toml" | sed -E 's/.*"([^"]+)".*/\1/')"
if [[ -z "$VERSION" ]]; then
  echo "错误：无法从 src-tauri/Cargo.toml 读取版本号。" >&2
  exit 1
fi

# 将任意文本转义为可安全嵌入 JSON 字符串的形式。
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

# 找到与目标平台对应的第一个匹配文件（glob）。
first_match() {
  local pattern=$1
  # shellcheck disable=SC2206
  local matches=( $pattern )
  if [[ -e "${matches[0]}" ]]; then
    printf '%s' "${matches[0]}"
  fi
}

declare -a PLAT_KEYS=()
declare -a PLAT_JSON=()

add_platform() {
  local key=$1 file=$2
  local sig="$file.sig"
  if [[ -z "$file" || ! -f "$file" ]]; then
    return
  fi
  if [[ ! -f "$sig" ]]; then
    echo "警告：找到安装包但缺少签名文件：$sig（跳过 $key）" >&2
    return
  fi
  local fname signature url
  fname="$(basename "$file")"
  signature="$(tr -d '\n\r' < "$sig")"
  url="$BASE_URL/$fname"
  PLAT_KEYS+=("$key")
  PLAT_JSON+=("    \"$key\": {\n      \"signature\": \"$signature\",\n      \"url\": \"$url\"\n    }")
  echo "已加入平台 $key -> $fname" >&2
}

# Windows：优先使用 NSIS 安装包（-setup.exe），否则回退 MSI。
WIN_NSIS="$(first_match "$BUNDLE_DIR/nsis/*-setup.exe")"
if [[ -n "$WIN_NSIS" ]]; then
  add_platform "windows-x86_64" "$WIN_NSIS"
else
  add_platform "windows-x86_64" "$(first_match "$BUNDLE_DIR/msi/*.msi")"
fi

# macOS：更新使用 .app.tar.gz；架构按当前构建机判断。
MAC_TGZ="$(first_match "$BUNDLE_DIR/macos/*.app.tar.gz")"
if [[ -n "$MAC_TGZ" ]]; then
  case "$(uname -m 2>/dev/null || echo)" in
    arm64|aarch64) add_platform "darwin-aarch64" "$MAC_TGZ" ;;
    x86_64) add_platform "darwin-x86_64" "$MAC_TGZ" ;;
    *) add_platform "darwin-aarch64" "$MAC_TGZ" ;;
  esac
fi

# Linux：AppImage。
LINUX_APP="$(first_match "$BUNDLE_DIR/appimage/*.AppImage")"
if [[ -n "$LINUX_APP" ]]; then
  add_platform "linux-x86_64" "$LINUX_APP"
fi

if [[ ${#PLAT_JSON[@]} -eq 0 ]]; then
  echo "错误：在 $BUNDLE_DIR 下未找到任何带 .sig 的安装包。请先执行 pnpm tauri build（并已配置签名密钥）。" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

NOTES_ESCAPED="$(json_escape "$NOTES")"

# 若已存在 latest.json 且有 jq，则把本次平台合并进去（便于多系统分别构建后汇总）。
if [[ -f "$OUT" ]] && command -v jq >/dev/null 2>&1; then
  echo "检测到已存在的 $OUT，使用 jq 合并平台条目…" >&2
  TMP_PLATFORMS="$(mktemp)"
  {
    printf '{\n'
    for i in "${!PLAT_JSON[@]}"; do
      printf '%b' "${PLAT_JSON[$i]}"
      if [[ $i -lt $((${#PLAT_JSON[@]} - 1)) ]]; then printf ',\n'; else printf '\n'; fi
    done
    printf '}\n'
  } > "$TMP_PLATFORMS"

  jq \
    --arg version "$VERSION" \
    --arg notes "$NOTES" \
    --arg pubdate "$PUB_DATE" \
    --slurpfile plats "$TMP_PLATFORMS" \
    '.version=$version | .notes=$notes | .pub_date=$pubdate
     | .platforms = ((.platforms // {}) + $plats[0])' \
    "$OUT" > "$OUT.tmp"
  mv "$OUT.tmp" "$OUT"
  rm -f "$TMP_PLATFORMS"
else
  {
    printf '{\n'
    printf '  "version": "%s",\n' "$VERSION"
    printf '  "notes": "%s",\n' "$NOTES_ESCAPED"
    printf '  "pub_date": "%s",\n' "$PUB_DATE"
    printf '  "platforms": {\n'
    for i in "${!PLAT_JSON[@]}"; do
      printf '%b' "${PLAT_JSON[$i]}"
      if [[ $i -lt $((${#PLAT_JSON[@]} - 1)) ]]; then printf ',\n'; else printf '\n'; fi
    done
    printf '  }\n'
    printf '}\n'
  } > "$OUT"
fi

echo "已生成：$OUT（版本 $VERSION，平台：${PLAT_KEYS[*]}）"
