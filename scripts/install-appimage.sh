#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/release"
APPIMAGE_BASENAME="subtasker.AppImage"
TARGET_BIN_DIR="${HOME}/.local/bin"
TARGET_DESKTOP_DIR="${HOME}/.local/share/applications"
TARGET_APPIMAGE="${TARGET_BIN_DIR}/${APPIMAGE_BASENAME}"
DESKTOP_FILE="${TARGET_DESKTOP_DIR}/subtasker.desktop"

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  echo "node_modules not found. Run 'npm install' first." >&2
  exit 1
fi

echo "→ Packaging Subtasker (npm run package)…"
( cd "${ROOT_DIR}" && npm run --silent package )

latest_appimage=$(ls -t "${RELEASE_DIR}"/Subtasker-*.AppImage 2>/dev/null | head -n1 || true)
if [[ -z "${latest_appimage}" ]]; then
  echo "No AppImage found in ${RELEASE_DIR}." >&2
  exit 1
fi

echo "→ Installing AppImage to ${TARGET_APPIMAGE}"
mkdir -p "${TARGET_BIN_DIR}"
install -m755 "${latest_appimage}" "${TARGET_APPIMAGE}"

cat >"${DESKTOP_FILE}" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Subtasker
Comment=Break big tasks into focused subtasks synced with Google Tasks
Exec=${TARGET_APPIMAGE}
Icon=Subtasker
Categories=Productivity;Utility;
StartupNotify=false
Terminal=false
DESKTOP

chmod 644 "${DESKTOP_FILE}"

cat <<MSG

Subtasker installed:
  Binary : ${TARGET_APPIMAGE}
  Desktop: ${DESKTOP_FILE}

If your launcher cache needs a refresh, run:
  update-desktop-database ${TARGET_DESKTOP_DIR}

Launch via dmenu/rofi or run 'subtasker.AppImage'.
MSG
