# Subtasker

Subtasker is an Electron + React desktop client for Google Tasks that layers AI-assisted task expansion on top of your existing lists. Load your own Google OAuth desktop credentials and an OpenAI API key to sign in, browse lists, author tasks, and summon ChatGPT (mini) to create or refine manageable micro-steps.

## Prerequisites

- Node.js 18+
- npm 9+
- Google Cloud project with an OAuth **Desktop** client and Tasks API enabled
- OpenAI API key with access to the ChatGPT (mini) model family

## Installation

```bash
npm install
```

## Development

Run the renderer (Vite) and Electron shell together:

```bash
npm run dev
```

The script opens the React UI on port 5173 and attaches Electron once the dev server is ready. Make changes in `src/` for the renderer or `electron/` for the main process.

## Build & Package

Create a production renderer bundle:

```bash
npm run build
```

Generate installable artifacts with Electron Builder:

```bash
npm run package        # auto-detects current platform
npm run package:mac    # macOS DMG (x64 + arm64 universal)
```

Outputs land in the `release/` directory.

### Install on macOS

```bash
./scripts/install-mac.sh
```

The helper runs `npm install`, builds the renderer, packages a DMG, and opens it for you to drag Subtasker into `/Applications`. Code signing is skipped for local builds — macOS may show a Gatekeeper prompt on first launch; right-click → Open to bypass it.

## First-Time Setup

1. Launch the app (`npm run dev` or packaged binary).
2. Open **Preferences → Google Tasks** and load your Desktop OAuth `client_secret.json` from Google Cloud.
3. Press **Sign In** and complete the Google login flow inside the pop-up window.
4. In **Preferences → OpenAI**, paste your API key, add any evergreen context about your role/team, and save. The key and context are stored locally via `electron-store`.

Tokens, API keys, and window sizing persist on disk so you only need to repeat these steps when rotating credentials.

## Core Features

- **Three-pane overview:** Sidebar for lists, a middle pane for top-level tasks, and a right pane that surfaces subtasks plus AI actions for the selected task.
- **Create / edit / delete:** Manage tasks or subtasks inline; edits sync straight to Google Tasks.
- **Expand Task with AI:** Gather a single context note and let ChatGPT (mini) return schema-validated subtasks (2–8 minutes each) nested under the parent.
- **Refine with AI:** Provide adjustments and receive an updated subtask plan that stays within the required schema and time bounds.
- **Hide completed:** Completed items are hidden by default at both task and subtask levels; toggle visibility per list when needed.
- **Personalized context:** Store default background info in Preferences so AI-generated guiding questions and subtasks stay aligned with your work.
- **AI controls:** Pick short vs. long plans, choose between simple or comprehensive tones, and even split existing subtasks into smaller steps.
- **Staged sync workflow:** Local changes queue until you press **Push Changes**. Unsynced items show a badge, and **Discard Changes** reverts to the latest data from Google Tasks.

## Loading Secrets & Storage Locations

- OAuth secrets and Google tokens are stored through `electron-store` in the OS app data directory.
- OpenAI keys live in the same store; replace them by pasting a new value and selecting **Remember Key**.
- Use **Sign Out** to revoke cached tokens and clear the session before switching accounts.

## Testing Notes

Subtasker does not bundle automated tests yet. During manual verification:

- Exercise sign-in using a test Google account.
- Confirm list retrieval, task CRUD, and AI flows in at least one list with nested subtasks.
- Validate Expand/Refine outputs respect the 2–8 minute window and “done when” phrasing before relying on them.

Contributions should include exploratory testing notes in pull requests until automated coverage is added.
