# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite renderer + Electron together with hot reload
npm run build        # Compile renderer to dist/
npm run package      # Build then package installers (electron-builder)
npm run package:mac  # Build then package macOS installer
npm start            # Launch Electron against compiled dist/ (requires build first)
```

No test runner is configured. Manual testing covers credential loading, Google sign-in/out, task CRUD, and the AI Expand/Refine/Split flows.

## Architecture

**Two-process Electron app:**

- `electron/` — main process (CommonJS). Owns all privileged I/O: Google OAuth (`googleAuth.js`), Google Tasks API (`googleTasks.js`), OpenAI calls (`openaiClient.js`), persistent settings via `electron-store` (`store.js`), and error logging (`logger.js`). `main.js` wires IPC handlers using the pattern `domain:action` (e.g. `google:listTasks`, `ai:planExpand`).
- `src/` — renderer process (React 19 + TypeScript, bundled by Vite). `App.tsx` is the single large component that owns all UI state. `preload.js` bridges the two processes by exposing `window.subtasker.*` via `contextBridge`.

**Key data flow — pending operations queue:**
All mutations (create/update/delete) are staged locally as `PendingOperation` objects in `App.tsx` before being flushed to Google Tasks via `google:applyChanges`. This staging layer drives the unsynced-change badges and push/discard workflow. Preserve this model when adding new mutations.

**AI integration:**
`electron/openaiClient.js` contains all prompts, JSON schemas, and `AiGenerationOptions` (length/style/split). Changes here affect Expand, Refine, and Split behaviour — call out prompt/schema changes in PRs so reviewers can re-run those flows.

## IPC Contract

The full `window.subtasker` API surface is defined in `electron/preload.js`. TypeScript types for it live in `src/types/global.d.ts`. New IPC channels must be registered in all three: `main.js` (`registerHandle`), `preload.js` (`contextBridge`), and `global.d.ts`.

## Electron/CommonJS vs TypeScript

`electron/` files are plain CommonJS (`require`/`module.exports`). `src/` is strict TypeScript ESM. Don't mix module systems across the boundary.
