# Google Drive asset sync (GitHub Action)

The **Sync assets to Google Drive** workflow
(`.github/workflows/drive-sync.yml`) mirrors this repo's `images/**` into the
Bonkey Apps Google Drive
([**Bonkey Puzzles**](https://drive.google.com/drive/folders/1TuaoncNIGTs6nb0NDeN1-_b0LHw0NfMH)),
keeping a shared copy of the site artwork.

- **Runs:** on every push to `main` that touches `images/**`, and on demand via
  **Actions → Sync assets to Google Drive → Run workflow**.
- **What it does:** for each mapping in `tools/drive-sync/manifest.json`
  (`images/` → **Web Images**), it ensures the Drive subfolder exists and
  uploads every file, **updating** files that already exist (matched by name)
  so re-runs never duplicate.
- **Owner:** files are created under **bonkey.apps@gmail.com** (the refresh
  token's account).

## One-time setup (required before the sync does anything)

Until the three secrets below are set, the workflow runs but the sync step is a
**no-op** (it exits 0 and blocks nothing).

### 1. Create an OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/) (signed in as
   **bonkey.apps@gmail.com**), create/select a project.
2. **APIs & Services → Library →** enable the **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Application type: Desktop app.** Note the **Client ID** and **Client
   secret**.

### 2. Get a refresh token (OAuth Playground — no local tooling)

1. Open [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/).
2. Click the ⚙️ (top-right) → check **Use your own OAuth credentials** → paste
   the Client ID / secret from step 1.
3. Authorize the scope **`https://www.googleapis.com/auth/drive`**, click
   **Authorize APIs**, and sign in as **bonkey.apps@gmail.com**.
4. Click **Exchange authorization code for tokens** and copy the **Refresh
   token**.

### 3. Add the repository secrets

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret                 | Value                        |
| ---------------------- | ---------------------------- |
| `GDRIVE_CLIENT_ID`     | OAuth client ID (step 1)     |
| `GDRIVE_CLIENT_SECRET` | OAuth client secret (step 1) |
| `GDRIVE_REFRESH_TOKEN` | Refresh token (step 2)       |

Optionally set the repo **variable** `GDRIVE_ROOT_FOLDER_ID` to override the
target folder; otherwise the folder id in `tools/drive-sync/manifest.json` is
used (this repo → the **Bonkey Puzzles** folder).

## Run it

Push a change under `images/`, or trigger **Run workflow** manually. The log
lists every created (`＋`) / updated (`↻`) file. Re-running is safe and
idempotent.

## Local dry-run

```bash
GDRIVE_CLIENT_ID=… GDRIVE_CLIENT_SECRET=… GDRIVE_REFRESH_TOKEN=… \
  node tools/drive-sync/sync.mjs
```

## Security

The refresh token grants write access to that Google account's Drive — keep it
only in GitHub **Secrets** (never commit it). The workflow uses first-party
actions pinned to major versions (`actions/checkout@v5`, `actions/setup-node@v5`)
and no third-party actions.
