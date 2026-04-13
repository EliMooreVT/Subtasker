# Repository Guidelines

## Project Structure & Module Organization
- `electron/` contains the Electron main process, preload bridge, Google API helpers, and OpenAI integration. Keep platform logic isolated here.
- `src/` houses the React renderer (Vite). `App.tsx` owns UI state for the three-pane layout; `styles.css` defines the ADHD-friendly styling; shared types sit in `src/types/`.
- Generated bundles are written to `dist/` (renderer output) and `release/` (Electron Builder artifacts). Treat both as build products.
- Root configs (`package.json`, `vite.config.ts`, `electron-builder.yml`, `tsconfig.json`) control tooling and packaging.

## Build, Test, and Development Commands
- `npm run dev` — run Vite and Electron together with hot reload for rapid iteration.
- `npm run build` — produce the production renderer bundle in `dist/`.
- `npm run package` — build then package desktop installers via Electron Builder.
- `npm start` — launch Electron against the compiled bundle (after `npm run build`).

## Coding Style & Naming Conventions
- TypeScript renderer code uses strict mode. Favor function components and hooks, PascalCase component files, camelCase utilities.
- Electron modules stay in CommonJS format; name IPC channels as `domain:action` and expose them via `window.subtasker`.
- Keep prompts and schema definitions in `electron/openaiClient.js` documented when changed so reviewers can assess behaviour shifts.
- UI text should be concise and instructional (e.g., “Expand Task with AI”, “Remember Key”).
- Unsynced change tracking lives in `App.tsx`; the pending operations queue powers the badges and push/discard workflow. Preserve that staging model when introducing new mutations.
- The preferences modal persists OpenAI API keys and default context via Electron store—update both values when adjusting credential flows.
- AI planning options (length, style, split) pass through `AiGenerationOptions`; keep them in sync across dialogs and the `plan*` IPC payloads.

## Testing Guidelines
- Manually test credential loading, Google sign-in/out, task CRUD, Expand, and Refine flows. Record notes in PR descriptions.
- Structure new helpers (task tree utilities, AI formatters) for future Jest coverage; avoid side effects in reusable functions.
- Never commit secrets. Use sandbox Google accounts and temporary API keys for verification.

## Commit & Pull Request Guidelines
- Prefer conventional commits (`feat:`, `fix:`, `docs:`) when they clarify intent. Keep each commit scoped to one change.
- PRs should summarize impact, link issues, note manual testing, and include screenshots/GIFs for UI tweaks.
- Call out AI prompt/schema adjustments so reviewers re-run Expand/Refine to validate behaviour.

## Security & Configuration Tips
- Store `client_secret.json` outside the repo; the app provides a loader. `.gitignore` already excludes it.
- Paste the OpenAI API key via the toolbar; Subtasker persists it locally with `electron-store`. Rotate keys routinely.
- Use **Sign Out** to clear tokens before switching Google accounts to avoid cross-account conflicts.
