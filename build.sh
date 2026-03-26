#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# build.sh — Package PageGrep for distribution
#
# Usage:
#   ./build.sh              # builds dist/pagegrep-<version>.xpi
#   ./build.sh --source     # also creates a dist/pagegrep-<version>-source.zip
# ---------------------------------------------------------------------------

VERSION=$(node -pe "require('./manifest.json').version" 2>/dev/null \
  || python3 -c "import json; print(json.load(open('manifest.json'))['version'])")

DIST_DIR="dist"
XPI_NAME="pagegrep-${VERSION}.xpi"
SOURCE_NAME="pagegrep-${VERSION}-source.zip"
XPI_PATH="${DIST_DIR}/${XPI_NAME}"
SOURCE_PATH="${DIST_DIR}/${SOURCE_NAME}"

mkdir -p "${DIST_DIR}"

# Files/dirs to include in the extension package
INCLUDE=(
  manifest.json
  background
  content
  sidebar
  options
  shared
  vendor
  icons
  _locales
)

# Remove any previous build of the same version
rm -f "${XPI_PATH}"

echo "Building ${XPI_NAME}..."

zip -r "${XPI_PATH}" "${INCLUDE[@]}" -x "*.DS_Store" "**/__pycache__/*"

echo "  Created ${XPI_PATH} ($(du -sh "${XPI_PATH}" | cut -f1))"

# --source flag: also bundle source code for AMO reviewer upload
if [[ "${1:-}" == "--source" ]]; then
  rm -f "${SOURCE_PATH}"
  echo "Building ${SOURCE_NAME}..."
  zip -r "${SOURCE_PATH}" . \
    -x "*.git/*" \
    -x "*.DS_Store" \
    -x "${DIST_DIR}/*" \
    -x "**/__pycache__/*" \
    -x ".amo-upload-uuid" \
    -x ".web-extension-id"
  echo "  Created ${SOURCE_PATH} ($(du -sh "${SOURCE_PATH}" | cut -f1))"
fi

echo "Done."
