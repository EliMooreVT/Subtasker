#!/bin/bash
# Subtasker dev launcher — pick a test/run mode quickly.
# Usage: npm run go [1-5]
#   Pass a number to skip the menu, e.g. npm run go 2

set -e
cd "$(dirname "$0")/.."

CHOICE="${1:-}"

if [ -z "$CHOICE" ]; then
  echo ""
  echo "  Subtasker — what do you want to run?"
  echo ""
  echo "  1  dev        Launch app (Electron + Vite hot-reload)"
  echo "  2  test       Unit tests (Jest)"
  echo "  3  build      Build + type check"
  echo "  4  test+build Unit tests then build + type check"
  echo "  5  full       All of the above"
  echo ""
  read -rp "  Choice [1-5]: " CHOICE
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
  *)
    echo "Invalid choice: $CHOICE" >&2
    exit 1
    ;;
esac
