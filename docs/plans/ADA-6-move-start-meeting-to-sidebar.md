# Feature Implementation Plan: ADA-6 + ADA-7 — "Start Meeting" in Sidebar, About in Settings

**Overall Progress:** `0%`

## TLDR

Replace the About/Info button in the sidebar footer with a "Start Meeting" button. Since the About button is being removed from the sidebar, embed its content (`<About />`) as a card at the bottom of the Settings page so it remains accessible. Remove the duplicate `AnalyticsConsentSwitch` from `About.tsx` (Settings already has one). Delete `Info.tsx` once unused. The home page is left completely untouched.

## Target UI Layout

```
Sidebar footer (expanded):
┌─────────────────────────────────┐
│  [ ⚙ Settings              ]   │
│  [ ▶ Start Meeting          ]   ← replaces About button
│  v0.2.0                        │
└─────────────────────────────────┘

Sidebar footer (collapsed):
  ⚙  (Settings icon)
  ▶  (Play icon — Start Meeting)

Settings page (bottom):
  [ Notifications card ]
  [ Data Storage card  ]
  [ Analytics card     ]
  [ About card         ]  ← new, shows About component content
```

---

## Critical Decisions

- **Home page is untouched** — `frontend/src/app/page.tsx` and its "Start New Meeting" button are not modified. The Home nav item in the sidebar also stays.
- **Start Meeting button replaces Info/About slot** — In the expanded footer, `<Info isCollapsed={isCollapsed} />` sits at line ~741. In the collapsed sidebar it's at line ~499. Both are replaced with "Start Meeting" buttons/icons.
- **Reuse `<About />` directly in Settings** — Import and render the existing `About` component inside a new card section in `PreferenceSettings.tsx`. No copy-pasting JSX.
- **Remove `AnalyticsConsentSwitch` from `About.tsx`** — The switch already exists in `PreferenceSettings.tsx`. Delete it from `About.tsx` (line ~146) and remove its import (line ~5) to eliminate the duplicate.
- **Delete `Info.tsx`** — Once both `<Info />` render sites in the sidebar are replaced, `Info.tsx` is unused and should be deleted.

---

## Tasks

- [ ] 🟥 **Step 1: Add Start Meeting button to sidebar (collapsed view)**
  - [ ] 🟥 In `frontend/src/components/Sidebar/index.tsx`, replace `<Info isCollapsed={isCollapsed} />` at line ~499 with a tooltip-wrapped `<button>` using `Play` icon from lucide-react; wire `setIsMeetingActive(true)`, `Analytics.trackButtonClick('start_new_meeting', 'sidebar')`, and `router.push('/meeting-details?id=new')`

- [ ] 🟥 **Step 2: Add Start Meeting button to sidebar (expanded view)**
  - [ ] 🟥 Replace `<Info isCollapsed={isCollapsed} />` at line ~741 with a "Start Meeting" button styled identically to the Settings button (`w-full flex items-center justify-center px-3 py-1.5 mt-1 mb-1 text-sm font-medium text-foreground/85 bg-white/10 hover:bg-white/15 rounded-lg transition-colors shadow-sm border border-white/10`) using `Play` icon; wire the same callbacks as Step 1

- [ ] 🟥 **Step 3: Clean up sidebar imports**
  - [ ] 🟥 Remove `import Info from '../Info'` (line 27) from `Sidebar/index.tsx` — no longer used after Steps 1 & 2

- [ ] 🟥 **Step 4: Remove AnalyticsConsentSwitch from About.tsx**
  - [ ] 🟥 In `frontend/src/components/About.tsx`, delete `<AnalyticsConsentSwitch />` (line ~146)
  - [ ] 🟥 Remove the `AnalyticsConsentSwitch` import (line ~5)

- [ ] 🟥 **Step 5: Add About section to PreferenceSettings**
  - [ ] 🟥 In `frontend/src/components/PreferenceSettings.tsx`, add `import { About } from './About'`
  - [ ] 🟥 After the Analytics card section (line ~226), add:
    ```tsx
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">About</h3>
      <About />
    </div>
    ```
  - [ ] 🟥 Dark-theme styling for this section handled separately by ADA-8

- [ ] 🟥 **Step 6: Delete Info.tsx**
  - [ ] 🟥 Confirm no remaining imports of `Info` in the codebase (grep for `from '../Info'` and `from './Info'`)
  - [ ] 🟥 Delete `frontend/src/components/Info.tsx`

---

## End Result

If the changes succeed, the app will behave as follows:

- **Home page unchanged**: The home page (`/`) still exists with its "Start New Meeting" button. The Home nav item in the sidebar still works.
- **"Start Meeting" in sidebar footer**: Both expanded and collapsed sidebar states show a "Start Meeting" button/icon in the footer slot where About used to be. Clicking it navigates to `/meeting-details?id=new`.
- **About content in Settings**: Opening Settings shows a new "About" card at the bottom — below the Analytics toggle — containing: the Adamant logo, version number, tagline, "Check for Updates" button, the 2×2 feature grid, Coming Soon banner, and CTA.
- **Single analytics toggle**: Exactly one `AnalyticsConsentSwitch` visible in the app (in Settings). The duplicate from the About popup is removed.
- **No dead code**: `Info.tsx` deleted, no dangling imports. TypeScript compiles cleanly.
- **Dark-theme styling deferred**: The About card in Settings will still use light-mode classes at this stage; ADA-8 handles the dark-theme pass.

---

## Verification

1. `cd frontend && pnpm run tauri:dev`
2. Home page (`/`) still loads normally with its "Start New Meeting" button — no change
3. Sidebar (expanded): "Start Meeting" button appears in footer where About used to be
4. Sidebar (collapsed): Play icon with tooltip "Start Meeting" appears where About used to be
5. Click sidebar "Start Meeting" → routes to `/meeting-details?id=new`, `start_new_meeting` analytics event fires
6. Open Settings → "About" card appears at the bottom with logo, version, feature grid, etc.
7. Only one `AnalyticsConsentSwitch` visible (no duplicate)
8. No TypeScript errors — `Info.tsx` deleted, no dangling imports

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
