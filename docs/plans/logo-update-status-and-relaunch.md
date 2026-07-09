# Adamant Logo Update Status and DMG Relaunch Flow

**Overall Progress:** `0%`

## Context

Clicking the Adamant logo in the top-left currently opens the About dialog, and the About content includes a static `Check for Updates` button that opens the GitHub releases page. That is convenient for discovery, but it does not tell the user whether they are already current, and it does not complete the update flow inside the app.

The desired behavior is:

- If the installed app is already on the latest release, the action should clearly say `No updates!`
- If a newer release exists, the action should say `Update and relaunch app`
- Clicking the update action should download the release artifact, install it, and relaunch Adamant without sending the user to a browser

This plan assumes the release target is the macOS DMG flow. That is the only place where "download the DMG" is a meaningful user-facing requirement. If the app is later expected to support a different updater artifact on Windows or Linux, that should be handled as a follow-up variant rather than mixed into this flow.

## Critical Decisions

- **Use the updater feed as the source of truth, not HTML scraping**  
  Do not scrape the GitHub releases web page. Reuse the updater metadata path already used by the app so the version check is deterministic and matches the actual downloadable artifact.

- **Keep the install/relaunch path inside `updateService`**  
  The UI should ask for status and trigger an install. It should not duplicate the updater download logic in `About.tsx`, `Logo.tsx`, and `UpdateDialog.tsx`.

- **Treat the logo/About entry point as the single user-facing location**  
  The logo dialog remains the entry point. The button inside it becomes status-aware instead of being a static external link.

- **Preserve the existing detailed update dialog as a fallback path**  
  The current `UpdateDialog` can still be used for progress/error detail if needed, but the main logo action should be one-click and direct.

- **Fallback behavior must be safe**  
  If the updater check fails, the button should not claim the user is up to date. It should surface a clear error state and avoid relaunching.

## Tasks

- [ ] **Step 1: Centralize update status and install actions**
  - [ ] Add a single service method in `frontend/src/services/updateService.ts` that:
    - checks for updates
    - returns a typed status object
    - downloads the release artifact when one is available
    - installs it and relaunches the app
  - [ ] Keep the existing throttling/caching behavior so the app does not spam the updater feed
  - [ ] Make the method usable from both the logo dialog and any existing update UI

- [ ] **Step 2: Replace the static About CTA with a status-aware action**
  - [ ] Update `frontend/src/components/About.tsx` so the update control is no longer a hard-coded `Check for Updates` button
  - [ ] Render `No updates!` when the latest version is already installed
  - [ ] Render `Update and relaunch app` when an update is available
  - [ ] While the app is checking for updates, show a loading state such as `Checking...`
  - [ ] While the app is downloading/installing, show progress or a disabled in-flight state

- [ ] **Step 3: Route the click to the actual updater flow**
  - [ ] Clicking `Update and relaunch app` should invoke the centralized update install path
  - [ ] The flow should download the signed updater artifact for the current platform, install it, and relaunch Adamant
  - [ ] Remove the default behavior that opens the GitHub releases page in a browser
  - [ ] Keep a browser fallback only for explicit manual support links, not for the primary update path

- [ ] **Step 4: Keep the logo entry point simple**
  - [ ] Leave `frontend/src/components/Logo.tsx` as the trigger for opening the About dialog
  - [ ] Do not add a second, separate update button outside the About content unless the UI explicitly needs one later
  - [ ] Ensure the logo dialog remains fast to open and does not block on network fetches before rendering

- [ ] **Step 5: Verify the release artifact path**
  - [ ] Confirm the updater feed points to the latest release metadata for the macOS build
  - [ ] Confirm the release workflow publishes the DMG asset expected by the updater
  - [ ] Confirm code signing and notarization requirements still satisfy macOS installation
  - [ ] If the release artifact name or location changed, update the publishing workflow and the client feed together

- [ ] **Step 6: Keep failure modes explicit**
  - [ ] If no network is available, surface a retryable error instead of misleadingly saying `No updates!`
  - [ ] If the release feed is unreachable or malformed, leave the current version untouched and report the failure
  - [ ] If the download/install step fails, keep the app running and show the error to the user

- [ ] **Step 7: Add focused verification**
  - [ ] Test the "already current" state and confirm the button label becomes `No updates!`
  - [ ] Test a simulated newer release and confirm the button label becomes `Update and relaunch app`
  - [ ] Test the full update path against a real release artifact in a staging build
  - [ ] Test a failed update check and a failed download separately

## Key Files

| File | Expected Change |
|------|-----------------|
| `frontend/src/components/About.tsx` | Replace the static update CTA with a status-aware action |
| `frontend/src/services/updateService.ts` | Add or consolidate the one-shot check/download/install/relaunch flow |
| `frontend/src/components/UpdateDialog.tsx` | Reuse the same update service path so the dialog and logo flow cannot diverge |
| `frontend/src/components/UpdateCheckProvider.tsx` | Keep update status available at app startup and expose it to the About dialog |
| `frontend/src/components/Logo.tsx` | Keep the logo as the entry point into the About dialog |
| `frontend/src-tauri/tauri.conf.json` | Confirm updater metadata and release artifact configuration are aligned |

## End Result

When this plan is fully implemented:

- Clicking the Adamant logo still opens the About dialog.
- The update control inside that dialog shows `No updates!` when the user is current.
- When a new release exists, the control changes to `Update and relaunch app`.
- Clicking that control downloads the updater artifact, installs it, and relaunches the app.
- The user no longer needs to visit GitHub manually just to complete a routine update.

## Verification

1. Launch a build that is already on the latest release.
2. Open the logo/About dialog.
3. Confirm the update control reads `No updates!`.
4. Launch a build with an available newer release.
5. Open the logo/About dialog.
6. Confirm the update control reads `Update and relaunch app`.
7. Click it and confirm the app downloads the artifact, installs it, and relaunches.
8. Confirm the app version after relaunch matches the newer release.
9. Confirm a failed update check does not relaunch the app and does not falsely report success.

