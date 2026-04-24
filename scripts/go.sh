#!/bin/bash
# Subtasker dev launcher — pick a test/run mode quickly.
# Usage: npm run go [1-5]
#   Pass a number to skip the menu, e.g. npm run go 2

set -e
cd "$(dirname "$0")/.."

CHOICE="${1:-}"
SIM_ID="213D4171-F94A-46F9-AAB0-F96D505611A5"   # iPhone 17 Pro simulator
BUNDLE_ID="com.subtasker.Subtasker"

if [ -z "$CHOICE" ]; then
  echo ""
  echo "  Subtasker — what do you want to run?"
  echo ""
  echo "  1  dev         Launch app (Electron + Vite hot-reload)"
  echo "  2  test        Unit tests (Jest)"
  echo "  3  build       Build + type check"
  echo "  4  test+build  Unit tests then build + type check"
  echo "  5  full        All of the above"
  echo "  6  ios         Build renderer then open Xcode project"
  echo "  7  ios-sim     Build + install + launch on iPhone 17 Pro simulator"
  echo "  8  ios-device  Build + install + launch on connected iPhone"
  echo ""
  read -rp "  Choice [1-8]: " CHOICE
  echo ""
fi

case "$CHOICE" in
  1)
    npm run dev
    ;;
  2)
    npm test
    ;;
  3)
    npm run build
    npx tsc --noEmit && echo "✓ No type errors"
    ;;
  4)
    npm test
    npm run build
    npx tsc --noEmit && echo "✓ No type errors"
    ;;
  5)
    npm test
    npm run build
    npx tsc --noEmit && echo "✓ No type errors"
    npm run dev
    ;;
  6)
    npx vite build --config vite.config.ios.ts
    open ios/Subtasker/Subtasker.xcodeproj
    ;;
  7)
    echo "→ Building iOS renderer…"
    npx vite build --config vite.config.ios.ts
    echo "→ Building Xcode (simulator)…"
    xcodebuild \
      -project ios/Subtasker/Subtasker.xcodeproj \
      -scheme Subtasker \
      -destination "platform=iOS Simulator,id=$SIM_ID" \
      -configuration Debug build 2>&1 | grep -E "error:|warning:|Build succeeded|FAILED" | tail -20
    APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData/Subtasker-*/Build/Products/Debug-iphonesimulator/Subtasker.app \
      -maxdepth 0 2>/dev/null | head -1)
    if [ -z "$APP_PATH" ]; then
      echo "✗ Could not find built .app — check xcodebuild output above" >&2
      exit 1
    fi
    echo "→ Installing on simulator…"
    xcrun simctl terminate "$SIM_ID" "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl install "$SIM_ID" "$APP_PATH"
    echo "→ Launching…"
    xcrun simctl launch "$SIM_ID" "$BUNDLE_ID"
    echo "✓ Running on simulator"
    ;;
  8)
    echo "→ Building iOS renderer…"
    npx vite build --config vite.config.ios.ts
    echo "→ Building Xcode (device)…"
    BUILD_LOG=$(xcodebuild \
      -project ios/Subtasker/Subtasker.xcodeproj \
      -scheme Subtasker \
      -destination "generic/platform=iOS" \
      -configuration Debug \
      -allowProvisioningUpdates build 2>&1)
    echo "$BUILD_LOG" | grep -E "error:|warning:|Build succeeded|FAILED" | tail -20
    if echo "$BUILD_LOG" | grep -q "requires a development team"; then
      echo "" >&2
      echo "✗ Code signing not configured. One-time fix:" >&2
      echo "   1. Run: npm run go 6  (opens Xcode)" >&2
      echo "   2. Click Subtasker in Project Navigator → Signing & Capabilities" >&2
      echo "   3. Set Team to your Apple ID (free Personal Team works)" >&2
      echo "   4. Re-run: npm run go 8" >&2
      exit 1
    fi
    APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData/Subtasker-*/Build/Products/Debug-iphoneos/Subtasker.app \
      -maxdepth 0 2>/dev/null | head -1)
    if [ -z "$APP_PATH" ]; then
      echo "✗ Could not find built .app — check xcodebuild output above" >&2
      exit 1
    fi
    # Find the first connected iPhone via devicectl (Xcode 15+)
    DEVICE_ID=$(xcrun devicectl list devices 2>/dev/null \
      | grep -v "Simulator" | grep -E "iPhone|iPad" \
      | awk '{print $NF}' | head -1)
    if [ -z "$DEVICE_ID" ]; then
      echo "✗ No iPhone found. Connect your device via USB and trust this Mac, then retry." >&2
      echo "  Available devices:" >&2
      xcrun devicectl list devices 2>/dev/null || true
      exit 1
    fi
    echo "→ Installing on device $DEVICE_ID…"
    xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
    echo "→ Launching…"
    xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"
    echo "✓ Running on device"
    ;;
  *)
    echo "Invalid choice: $CHOICE" >&2
    exit 1
    ;;
esac
