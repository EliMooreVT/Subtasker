#!/usr/bin/env bash
# install-mac.sh — build and install Subtasker on macOS
# Usage: ./scripts/install-mac.sh
# Builds the DMG and opens it so you can drag Subtasker into /Applications.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "→ Installing dependencies..."
npm install

echo "→ Building renderer..."
npm run build

echo "→ Packaging macOS DMG..."
# Skip code signing for local builds — set CSC_IDENTITY_AUTO_DISCOVERY=false
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac

DMG_PATH=$(find release -name "*.dmg" | sort -V | tail -1)

if [ -z "$DMG_PATH" ]; then
  echo "✗ No DMG found in release/. Build may have failed."
  exit 1
fi

echo "✓ Built: $DMG_PATH"
echo "→ Opening DMG — drag Subtasker to Applications to install."
open "$DMG_PATH"
