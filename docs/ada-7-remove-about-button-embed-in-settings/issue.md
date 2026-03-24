# ADA-7: Remove About Button from Sidebar, Embed About in Settings

**Type:** Improvement | **Priority:** Low | **Effort:** Small

## TL;DR

The About modal (triggered by the Info icon in the sidebar footer) takes up a footer slot and requires a separate interaction. Remove the button entirely and embed the About content as a section at the bottom of the Settings page, consolidating app info into one place.

## Current Behavior

- Sidebar footer has an Info (About) button that opens a modal dialog
- About modal contains: logo, version, tagline, feature grid (4 cards), "Coming Soon" banner, CTA/business link, and analytics consent switch
- Settings page also has an analytics consent switch (duplicate)

## Expected Behavior

- No About/Info button in the sidebar footer
- Settings page has an "About" section at the bottom containing all the above content
- Analytics consent switch exists only in Settings (deduplicated)

## Files to Touch

1. `frontend/src/components/Sidebar/index.tsx` — Remove `Info` component usage from footer (both expanded and collapsed sidebar views)
2. `frontend/src/components/PreferenceSettings.tsx` — Add "About" section at bottom: logo, version, tagline, feature grid, Coming Soon banner, CTA
3. `frontend/src/components/Info.tsx` — Can be deleted once unused

## Notes / Risks

- Analytics consent switch currently lives in both About and Settings — keep only the Settings instance after this change
