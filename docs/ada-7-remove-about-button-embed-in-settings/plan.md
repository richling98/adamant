# ADA-7 — Merged into ADA-6

> This plan has been merged into [ADA-6](./ADA-6-move-start-meeting-to-sidebar.md). All tasks for removing the About button and embedding About in Settings are tracked there.

---

# Feature Implementation Plan: ADA-7 Remove About Button, Embed About in Settings

**Overall Progress:** `0%`

## TLDR

Remove the Info/About button from the sidebar footer (done as part of ADA-6, or independently here). Embed the `About` component as a section at the bottom of the Settings page (`PreferenceSettings.tsx`). Remove the duplicate `AnalyticsConsentSwitch` from `About.tsx` since Settings already has one. Delete `Info.tsx` once unused.

---

## Critical Decisions

- **Reuse `<About />` directly in Settings** — Import and render the existing `About` component inside a new card section in `PreferenceSettings.tsx`. No copy-pasting JSX; version/update logic stays centralized in `About.tsx`.
- **Remove `AnalyticsConsentSwitch` from `About.tsx`** — The switch already exists in `PreferenceSettings.tsx` (line ~224). Delete it from `About.tsx` (line 146) and remove its import (line 5) to eliminate the duplicate.
- **Sidebar removal depends on ADA-6** — If ADA-6 was implemented first, the Info button is already gone from the sidebar. If implementing ADA-7 standalone, also remove `<Info isCollapsed={isCollapsed} />` from sidebar lines ~499 and ~741, and remove `import Info from '../Info'` (line 27).
- **Delete `Info.tsx`** — Once no component imports it, `frontend/src/components/Info.tsx` can be deleted entirely.

---

## Tasks

- [ ] 🟥 **Step 1: Remove AnalyticsConsentSwitch from About.tsx**
  - [ ] 🟥 In `frontend/src/components/About.tsx`, delete `<AnalyticsConsentSwitch />` (line 146)
  - [ ] 🟥 Remove the `AnalyticsConsentSwitch` import (line 5)

- [ ] 🟥 **Step 2: Add About section to PreferenceSettings**
  - [ ] 🟥 In `frontend/src/components/PreferenceSettings.tsx`, add `import { About } from './About'`
  - [ ] 🟥 After the Analytics card section (line ~226), add:
    ```tsx
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">About</h3>
      <About />
    </div>
    ```
  - [ ] 🟥 Dark-theme styling for this section handled separately by ADA-8

- [ ] 🟥 **Step 3: Remove Info/About from sidebar (skip if ADA-6 already done)**
  - [ ] 🟥 In `frontend/src/components/Sidebar/index.tsx`, remove `<Info isCollapsed={isCollapsed} />` at line ~499 (collapsed view)
  - [ ] 🟥 Remove `<Info isCollapsed={isCollapsed} />` at line ~741 (expanded footer)
  - [ ] 🟥 Remove `import Info from '../Info'` (line 27)

- [ ] 🟥 **Step 4: Delete Info.tsx**
  - [ ] 🟥 Confirm no remaining imports of `Info` in the codebase (grep for `from '../Info'` and `from './Info'`)
  - [ ] 🟥 Delete `frontend/src/components/Info.tsx`

---

## End Result

If the changes succeed, the app will behave as follows:

- **No standalone About button in sidebar**: The Info/About button is gone from both expanded and collapsed sidebar states. There is no dedicated About popup/modal accessible from the sidebar.
- **About content in Settings**: Opening Settings (via the ⚙ icon) shows a new "About" card at the bottom of the settings page — below the Analytics toggle — containing: the Adamant logo, version number, tagline, "Check for Updates" button, the 2×2 feature grid, Coming Soon banner, and CTA.
- **Single analytics toggle**: There is exactly one `AnalyticsConsentSwitch` visible in the app — in the Settings page. The duplicate that previously appeared inside the About popup is removed.
- **No dead code**: `Info.tsx` is deleted and no dangling imports remain. TypeScript compiles cleanly.
- **Dark-theme styling deferred**: The About card in Settings will still use light-mode classes at this stage; ADA-8 handles the dark-theme pass.

---

## Verification

1. `cd frontend && pnpm run tauri:dev`
2. Open Settings — "About" section appears at the bottom, below Analytics
3. About section shows: logo, version, tagline, "Check for Updates" button, 2×2 feature grid, Coming Soon banner, CTA button
4. Only one `AnalyticsConsentSwitch` visible in Settings (no duplicate from About)
5. Sidebar footer has no Info/About button in either expanded or collapsed state
6. No TypeScript errors — `Info.tsx` deleted, no dangling imports

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
