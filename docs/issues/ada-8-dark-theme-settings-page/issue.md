# ADA-8: Apply Dark Theme to Settings Page

**Type:** Improvement | **Priority:** Low | **Effort:** Small

## TL;DR

The Settings page currently uses a white/light background that clashes with the rest of the app's dark UI. Apply the same dark palette used in the sidebar and other panels to make the Settings page visually consistent.

## Current Behavior

- Settings page renders with a white/light background (`bg-white`, light text colors)
- Visually inconsistent with the sidebar and meeting details panels which use dark tones (`bg-[#111]`, `text-zinc-*`)

## Expected Behavior

- Settings page background matches the app's dark palette (e.g., `bg-[#111]` or `bg-zinc-900`)
- Section headings, labels, descriptions, and toggle controls use dark-appropriate text colors (`text-white`, `text-zinc-400`)
- All cards, dividers, and input elements follow the same dark theme

## Files to Touch

1. `frontend/src/components/PreferenceSettings.tsx` — Replace `bg-white`, `text-gray-900`, and related light Tailwind classes with dark equivalents matching the sidebar palette

## Notes / Risks

- Reference `frontend/src/components/Sidebar/index.tsx` for the exact color tokens in use (`bg-[#111]`, `text-zinc-400`, `border-zinc-800`, etc.)
- If an About section is added (ADA-7), its dark styling should be applied here in the same pass
