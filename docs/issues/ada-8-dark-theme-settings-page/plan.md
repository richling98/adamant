# Feature Implementation Plan: ADA-8 Dark Theme for Settings Page

**Overall Progress:** `0%`

## TLDR

The Settings page uses a white/light Tailwind theme that clashes with the app's dark UI. Replace all light-mode classes in `PreferenceSettings.tsx` and `About.tsx` with dark equivalents drawn from the sidebar's existing palette.

## Color Reference (from Sidebar/index.tsx)

| Purpose             | Current (light)                  | Dark replacement                  |
|---------------------|----------------------------------|-----------------------------------|
| Card background     | `bg-white`                       | `bg-[#1a1a1a]`                    |
| Card border         | `border-gray-200`                | `border-white/10`                 |
| Card shadow         | `shadow-sm`                      | _(remove or keep as-is)_          |
| Heading text        | `text-gray-900`                  | `text-white`                      |
| Body/description    | `text-gray-600`                  | `text-zinc-400`                   |
| Inner card bg       | `bg-gray-50`                     | `bg-white/5`                      |
| Inner card border   | `border` (gray)                  | `border border-white/10`          |
| Info/note box       | `bg-blue-50 text-blue-800`       | `bg-blue-900/20 text-blue-300`    |
| Button border       | `border-gray-300`                | `border-white/20`                 |
| Button hover        | `hover:bg-gray-100`              | `hover:bg-white/10`               |
| Button text         | _(inherited)_                    | `text-zinc-300`                   |
| Footer border       | `border-gray-200`                | `border-white/10`                 |
| Muted text          | `text-gray-400`                  | `text-zinc-500`                   |
| Section subheading  | `text-gray-800`                  | `text-zinc-200`                   |

---

## Critical Decisions

- **Apply changes per card in `PreferenceSettings.tsx`** — Three existing cards (Notifications, Storage, Analytics) plus the About card added by ADA-7. Touch each card's wrapper, heading, description, and inner elements individually.
- **Update `About.tsx` inner styles** — The feature grid cards use `bg-gray-50 hover:bg-gray-100` and gray text. When rendered inside the dark Settings page these look jarring. Update `About.tsx` to use dark tokens so it looks correct in its new context.
- **Loading state divs need dark text** — Lines 138 and 143 in `PreferenceSettings.tsx` return early with a plain div; add `text-white` so "Loading Preferences..." is visible on a dark background.

---

## Tasks

- [ ] 🟥 **Step 1: Dark-theme loading states in PreferenceSettings**
  - [ ] 🟥 Lines 138 and 143: add `text-white` to the loading div classNames

- [ ] 🟥 **Step 2: Dark-theme Notifications card**
  - [ ] 🟥 Card wrapper: `bg-white rounded-lg border border-gray-200 p-6 shadow-sm` → `bg-[#1a1a1a] rounded-lg border border-white/10 p-6`
  - [ ] 🟥 Heading `text-gray-900` → `text-white`
  - [ ] 🟥 Description `text-gray-600` → `text-zinc-400`

- [ ] 🟥 **Step 3: Dark-theme Data Storage card**
  - [ ] 🟥 Card wrapper: same swap as Step 2
  - [ ] 🟥 Heading and description: same swap as Step 2
  - [ ] 🟥 Inner recording location card: `bg-gray-50` → `bg-white/5`; inner border → `border-white/10`
  - [ ] 🟥 Location label `font-medium` → add `text-white`
  - [ ] 🟥 Path monospace text `text-gray-600` → `text-zinc-400`
  - [ ] 🟥 "Open Folder" button: `border-gray-300 hover:bg-gray-100` → `border-white/20 hover:bg-white/10 text-zinc-300`
  - [ ] 🟥 Note box: `bg-blue-50 text-blue-800` → `bg-blue-900/20 text-blue-300`

- [ ] 🟥 **Step 4: Dark-theme Analytics card**
  - [ ] 🟥 Card wrapper: same swap as Step 2

- [ ] 🟥 **Step 5: Dark-theme About card (added by ADA-7)**
  - [ ] 🟥 Card wrapper: same swap as Step 2
  - [ ] 🟥 Card heading: `text-gray-900` → `text-white`

- [ ] 🟥 **Step 6: Dark-theme About.tsx inner elements**
  - [ ] 🟥 Version text: `text-gray-500` → `text-zinc-400`
  - [ ] 🟥 Tagline: `text-gray-600` → `text-zinc-400`
  - [ ] 🟥 Section subheading "What makes Adamant different": `text-gray-800` → `text-zinc-200`
  - [ ] 🟥 Feature grid cards: `bg-gray-50 hover:bg-gray-100` → `bg-white/5 hover:bg-white/10`
  - [ ] 🟥 Feature card headings: `text-gray-900` → `text-white`
  - [ ] 🟥 Feature card body text: `text-gray-600` → `text-zinc-400`
  - [ ] 🟥 Coming Soon box: `bg-blue-50 text-blue-800` → `bg-blue-900/20 text-blue-300`
  - [ ] 🟥 CTA heading: `text-gray-800` → `text-zinc-200`
  - [ ] 🟥 CTA body text: `text-gray-600` → `text-zinc-400`
  - [ ] 🟥 Footer divider: `border-gray-200` → `border-white/10`
  - [ ] 🟥 Footer "Built by" text: `text-gray-400` → `text-zinc-500`

---

## Verification

1. `cd frontend && pnpm run tauri:dev`
2. Open Settings — entire page has dark background; no white cards visible
3. All text readable: headings white, descriptions zinc-400
4. Notifications toggle still functional and visible
5. "Open Folder" button readable and hoverable on dark bg
6. Info note box uses dark blue tone (not light blue)
7. About section (from ADA-7) is dark-themed consistently
8. Loading state "Loading Preferences..." is visible (not invisible white-on-white)

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
