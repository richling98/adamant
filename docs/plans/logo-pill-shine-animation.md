# Adamant Logo Pill Shine Animation

**Overall Progress:** `0%`

## Context

The top-left Adamant logo pill currently uses a linear shimmer effect that scans across the surface in a way that reads as flat and mechanical. The desired effect is more like a glossy glass or polished metal badge: a slow, subtle light sweep with a faint twinkle that makes the pill feel reflective without changing its position.

The animation should:

- feel slow and premium, not flashy or fast
- look like a specular highlight moving over glass or brushed steel
- preserve the current pill shape and layout
- stay theme-aware so the effect still fits Rune, Mithril, Bronze, and Adamant

This is a visual polish change only. It should not change the logo click behavior, the About dialog, or any surrounding sidebar layout.

## Critical Decisions

- **Use layered highlights instead of a single background sweep**  
  Replace the current flat left-to-right shimmer with a combination of:
  - a soft moving highlight band
  - a subtle stationary sheen
  - a very faint secondary glint or twinkle

- **Keep motion restrained**  
  The effect should move slowly enough to feel like light catching a polished surface, not a loading bar or a neon sweep.

- **Prefer CSS-only implementation in `Logo.tsx`**  
  Use pseudo-elements or layered gradients if possible. Avoid introducing a new animation framework for a single pill effect.

- **Preserve theme-specific surfaces**  
  The base pill gradients already vary by theme. The sheen should be added on top of those existing surfaces rather than replacing them.

- **Do not animate the collapsed icon button**  
  If the collapsed icon already feels correct, keep the change limited to the expanded pill variant unless the icon version clearly needs parity.

## Tasks

- [ ] **Step 1: Redesign the pill highlight layers**
  - [ ] Update `frontend/src/components/Logo.tsx` so the expanded pill uses a more realistic reflective treatment
  - [ ] Add a soft moving highlight band that travels diagonally or slightly off-axis
  - [ ] Add a second subtle sheen layer so the pill feels like glass or polished metal
  - [ ] Keep the base theme gradient visible underneath the highlight layers

- [ ] **Step 2: Tune the animation timing**
  - [ ] Make the sweep noticeably slower than the current shimmer
  - [ ] Use easing that feels organic rather than linear
  - [ ] Avoid repetitive flashiness by keeping contrast low and motion smooth

- [ ] **Step 3: Add a faint glimmer or twinkle**
  - [ ] Introduce a tiny specular sparkle or glint that appears briefly as the highlight passes
  - [ ] Keep this effect subtle so it reads as shine, not particle animation
  - [ ] Ensure the effect is still tasteful in all supported themes

- [ ] **Step 4: Preserve accessibility and interaction**
  - [ ] Keep the logo pill clickable exactly as it is today
  - [ ] Avoid reducing contrast between the logo text/icon and the pill background
  - [ ] Ensure the animation does not distract from hover/focus affordances or make the text harder to read

- [ ] **Step 5: Verify visual consistency**
  - [ ] Check the pill in all four themes: Rune, Mithril, Bronze, Adamant
  - [ ] Confirm the Bronze theme reads as warm gold/bronze rather than green
  - [ ] Confirm the motion feels slow and premium instead of linear and mechanical
  - [ ] Confirm the collapsed icon state still looks correct and does not need the same treatment

## Key Files

| File | Expected Change |
|------|-----------------|
| `frontend/src/components/Logo.tsx` | Replace the current linear shimmer with a more realistic reflective animation |
| `frontend/src/app/globals.css` | Only if shared keyframes or theme-scoped utility styles are needed |

## End Result

When this plan is fully implemented:

- The top-left logo pill will look like a polished, reflective surface rather than a flat animated gradient.
- The light sweep will feel slower and more natural.
- The animation will still match the selected color palette.
- The pill will retain its current size, placement, and click behavior.

## Verification

1. Open Adamant in each supported theme.
2. Observe the expanded logo pill in the top-left.
3. Confirm the highlight reads as a soft glimmer or sheen rather than a linear shimmer.
4. Confirm the motion is slow and subtle.
5. Confirm the effect does not obscure the logo or degrade legibility.
6. Confirm the collapsed logo state remains unchanged unless intentionally updated.

