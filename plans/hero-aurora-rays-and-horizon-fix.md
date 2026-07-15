# Plan: Fix Horizon Overlap + Rebuild Aurora Rays (COSMOQ-style)

Date: 2026-07-11
Status: Draft — awaiting review
Scope: `website/index.html` only (static single-file homepage)
Preview: `http://localhost:8787`

---

## Problem Statement

### Current screenshot (Adamant) vs Target (COSMOQ)

| Aspect | Current | Target (COSMOQ ref) |
|---|---|---|
| **Horizon line** | Green rim line *cuts through* the middle of the app mockup. Planet is at `top: 680px` with 4400px diameter → rim is ~760px below top of hero, which sits right in the dashboard card area. | Horizon is a solid luminous rim at the very top of the planet, and the dashboard/app card sits *entirely below* that rim, overlapping only the dark side of the planet (not the light rays). See COSMOQ: Analytics Agent card sits fully below the white horizon glow, on dark space. |
| **Aurora / Rays** | Soft blurred radial glows (two gentle washes, dark emerald + mint). Looks like fog / ambient light, not beams. No distinct shafts. Previous attempt had hard-edged triangles when using rotated divs with linear gradients — those were removed, leaving only soft glow. | **Distinct, sharp, tall vertical light columns / rays** rising from behind the planet rim. ~5-6 columns: left side warm amber/gold, right side cool blue/cyan. Each column has: a bright narrow core at bottom that widens and fades upward, soft feathered edges (not hard triangle clipping), strong verticality, varied height/width. The columns feel like searchlight beams through haze. |
| **Color** | Single green family, same hue dark+light. | In COSMOQ: amber → blue split. For Adamant: dark emerald `#042F22` / `#065F46` → light mint `#A7F3D0` / `#6EE7B7`. Requirement from user: light green + dark green transitioning. |
| **Animation** | Gentle drift (screen-space translate). | User says: "Let's not worry about animations for now." — so static or very subtle sway only. Priority is visual correctness first. |

### Pain that matters
- The planet + app mock overlap makes the page feel broken, not intentional.
- Without rays, the hero looks empty / generic. The COSMOQ-like rays are the signature visual that sells "coming from your machine / private by design / light emerging."

---

## Goals & Non-Goals

**Goals:**
- [ ] Horizon rim sits *clearly above* the app mock (no overlap of bright rim with app content)
- [ ] Sharp, distinct vertical aurora rays, 5-7 beams, dark-to-light green transition, COSMOQ-style but in green
- [ ] No hard-edged triangle artifacts (previous failure mode)
- [ ] Single file still, no external assets except existing logo + grain PNG
- [ ] Works on 1440px desktop and 390px mobile, no layout jank

**Non-Goals (this PR):**
- Animated sway / drift (defer, keep static so we don't reintroduce blur bugs)
- New sections below hero (Features, How it works, etc.)
- Dashboard mock visual polish (will address after horizon is fixed)
- Performance beyond 60fps idle

---

## Root Cause of Triangle Artifacts (so we don't repeat)

Last 3 attempts failed the same way:

1. **CSS rotated divs with `clip-path: polygon(...)` + `linear-gradient` + `filter: blur()` + `mix-blend-mode: screen`**
   - `clip-path` clips *before* blur, so blur softens the interior but the clipped edge still shows as a hard rect against black background.
   - `mix-blend-mode: screen` on overlapping blurred rects creates bright intersections that reveal the rectangular bounds.
   - Rotated divs have axis-aligned bounding boxes larger than the visible triangle, and `filter: blur(N)` doesn't feather outside the box on some compositors — leaves a faint rectangle.

2. **Canvas: drawing tall sliced trapezoids with overlapping ellipses per height step**
   - Used `globalCompositeOperation = 'screen'` per beam.
   - Each beam's radial stack still had an overall alpha that, when two beams overlap, creates a brighter hard-edged overlap shape.
   - Small `ellipse` per horizontal slice: quickly reveals vertical banding and rectangular stacking artifacts in the composite.

**Lesson:** Any time we have *more than one element* whose semi-transparent bounds overlap on black with `screen` blending, the intersection becomes visible as a darker/lighter shape. Solutions that work:
- **Single canvas, additive compositing done carefully with light-only colors, no dark fills**
- **Or single blurred container with only additive (lighter) colors — never include dark rgba() that subtracts**
- **Or use CSS `mask-image` to feather edges, not rely on blur alone**

---

## Proposed Approach

### A. Horizon / Planet positioning fix (the easy half)

Current:
- `.planet` is `position: absolute` inside `.hero-backdrop` (which is `height: 940px`).
- `top: 680px`, `width: 4400px`, `height: 4400px` → center is massively below, but the visible top arc of the circle sits at roughly `top + 0%` of the circle → the top of the dome is at `680px` from top of backdrop.
- `.dashboard-section` is at `margin: 88px auto 0` from *after* hero content. Hero content is ~400px tall (label + title + sub + CTA). So dashboard top is at roughly `88+400+...` ~580px from top of hero, while planet top is at 680px → overlap by ~100px, and the glowing rim sits right in the middle of the card.

Fix:
- Move planet such that **its top edge + glow sits above the dashboard card's top edge**, with comfortable whitespace.
- Simplest: make `.hero-backdrop` taller *and* move planet top so rim is at clear vertical gap between CTA and dashboard.
- Specifically:
  - `.hero-backdrop` height: 940px → 1060px (or 1120px) to give room.
  - `.planet` top: 680px → **820-860px** (lowers the dome, so the bright rim sits ~820px from top, below the CTA ~520px). That puts rim ~300px below CTA and dashboard at `margin: 40px` from after that.
  - `.dashboard-section` margin-top: reduce to `20-32px` and use `position: relative; z-index: 12; margin-top: -40px` -ish so it tucks *below* rim with a small overlap into dark planet, not into light.
  - Visually: `hero content (centered) -> CTA -> ~160px gap -> horizon glow line -> ~24px gap -> app card top sits on dark planet surface, no glow behind it.`

Alternative considered and rejected:
- Moving dashboard further down (increases page length too much, breaks above-fold balance).
- Making planet smaller (hurts the "massive planet horizon" feel from COSMOQ which uses r~1200px for a 2400px ball).

Target numbers to tune live:
```
backdrop height: 1080px
planet top:      860px
planet size:     4200px (slightly smaller than 4400 for less overflow)
dashboard margin-top: 120px (physical distance from top of hero section, but because hero-backdrop is absolute, we need to position dashboard so its top is ~940px from top of hero and planet rim is at 860px+ glow = ~872px, so dashboard starts 68px below rim)
```

Will verify with screenshot at each tweak.

### B. Aurora Rays — rebuilt correctly (the hard half)

**Reference deconstruction (COSMOQ):**
- Look at Screenshot 2026-07-11 at 1.41.32 PM:
  - Background is black with faint stars + grain.
  - Behind planet rim, ~2 big soft columns (amber ~18-24% width on left, blue ~28-32% on right). They are blurred, not sharp at top.
  - Inside those columns: **sharper, narrower vertical shafts / rays** (~3-4 per side). These are the "rays" — they have:
    - Bright core at bottom near rim (almost white in center)
    - Color along shaft: amber centers → orange → dark brown at edges (left), white → cyan → dark blue at edges (right)
    - Edges are soft (feathered ~20-40px horizontal), not hard.
    - Height varies: some reach 70% of viewport, some only 35%.
    - Tilt: 3-8° off vertical, all emanating from horizon center-bottom.
    - Overlap: where rays cross, brightness adds — but no hard-edge darkening because all colors are additive/light.
  - Overall effect: looks like sun through clouds / searchlights, not like fog.

**Adamant adaptation — green version:**
- Left/dark side: deep emerald to mid-green
  - Core: `#ECFDF5` → `#6EE7B7` → `#059669` → `#022C22` (light to dark across horizontal feather, and light to dark up the shaft vertically: brightest at bottom near rim)
- Right/light side: mint to emerald
  - Core: `#ECFDF5` → `#A7F3D0` → `#10B981` → `#042F22`

**Implementation that avoids previous bugs:**

Option 1 (Preferred): **Single canvas, additive-only, no screen blend on dark colors**

```
canvas covers entire hero-backdrop
Steps:
1. fill black
2. draw stars (same as now, under rays)
3. switch to lighter composite: ctx.globalCompositeOperation = 'lighter' (not 'screen' - lighter doesn't darken overlapping dark alphas)
4. For each of 6 ray definitions:
   - define a tapered path: a long trapezoid but drawn with a horizontal linear gradient that feathers edges, not filled solid
   - technique: for each ray, draw ONE vertical gradient rect, clipped to a feathered alpha mask made from a horizontal gradient.
   - Actually: use ctx.createLinearGradient for vertical fade (bright at bottom, transparent at top)
     and modulate alpha horizontally with a separate gradient via globalAlpha or second pass.
   - Key: use ONLY bright/light colors (rgba with green values > 60, alpha < 0.5) so 'lighter' never reveals dark rects.
   - Feather: add 24px horizontal blur via offscreen low-res render OR use radial gradients instead of rects.
   - Simpler robust way: each ray = two overlapping radial gradients stacked vertically:
     - bottom radial anchored at horizon point that makes a "cone" bright near rim, fades upward
     - top radial much larger, dimmer, extends the beam
     Both are radial so they have no hard edges at all.
5. After rays, draw broad washes (huge low-alpha radials behind rays) for ambient glow, same lighter comp
6. Draw planet rim AFTER canvas (DOM element, on top of canvas at z-index 4) so rim is crisp and covers south edge of rays
7. Set canvas filter?: NO filter — radial gradients are already feathered, no CSS blur needed. Keeps edges soft without revealing boxes.
```

Why this avoids triangles:
- Radials fade to `transparent` at their radius edge — no box.
- `lighter` compositing of only light colors never produces a darker intersection.
- Single canvas — no DOM box overlapping.
- No CSS `filter: blur()` on elements with backgrounds that have hard rect origins.

Ray parameters (starting point, tune visually):
```
Count: 6 (3 dark emerald left/center, 3 mint right)
Positions (x as % of W from left, anchored at horizon):
  R1 left:    x=0.06  width bottom=14%  top=4%   height=62%  color: 04 61 48  alpha: 0.38 tilt: -6deg
  R2 left-mid x=0.20  width b=16% t=5%  h=78%  color: 06 95 70  a:0.46  tilt: -2.5deg
  R3 center   x=0.40  w b=12% t=3% h=48%  color: 10 185 129 a:0.18  tilt: 0deg
  R4 mid-right x=0.60 w b=13% t=3.5% h=52% color: 110 231 183 a:0.22 tilt: +1deg
  R5 right    x=0.74  w b=18% t=6%  h=86%  color: 110 231 183 a:0.48 tilt: +4deg (brightest)
  R6 far right x=0.90 w b=12% t=4% h=62% color: 167 243 208 a:0.32 tilt: +6.5deg
Core brightening: all rays get an inner 20%-width hot core of #ECFDF5 at 0.12 alpha blended at bottom 0-18% of height.

Implementation detail for tapered beam using 2D canvas:
  Don't draw a polygon — draw a single stretched radial gradient whose focal point is at the horizon base.
  Using: 
    const hw = horizonY;
    const grad = ctx.createRadialGradient(cx, hw, 0, cx, hw - h*0.25, h*1.35);
    // then mask horizontally: create secondary grad that fades sideways, composite via globalAlpha trick
  Or simpler: draw ray as a vertical linear gradient clipped to a horizontal alpha gradient using offscreen canvas:
    - create offscreen canvas sized to ray bounds
    - draw vertical linear gradient (bottom bright -> top transparent) into it
    - apply horizontal alpha mask (center opaque -> edges transparent) via globalCompositeOperation = 'destination-in' with a horizontal black->white->black gradient
    - then draw that offscreen canvas into main canvas with slight perspective skew via transform (ctx.setTransform with tiny shear for tilt)
  This guarantees feathered edges on ALL four sides.

For first version we will skip perspective skew and just use radial gradients to keep it sharp and not over-engineer.

Add subtle grain on top (already done via CSS .hero-grain, but also add fine canvas grain via low-alpha speckles to match COSMOQ's film grain).
```

Option 2 (Fallback if canvas still shows edges): **CSS-only with mask-image**

- Use `.ray { background: linear-gradient(...); mask-image: radial-gradient(ellipse ...); -webkit-mask-image: ... }`
- Mask feathers all edges of the div to transparent, so even if div has a box, mask makes edges soft.
- Still risk of `screen` blend darkening — would need to only use light colors and `mix-blend-mode: screen` sparingly.

Decision: **Go with Option 1 canvas.**

### C. Structure after fix

```
.framer-hero
  .hero-backdrop (height 1080px, absolute)
    #auroraCanvas (z-index 2) — all stars + rays + washes, single element, no other aurora dom nodes
    .planet (z-index 4, top 860px, 4200px) — sits above canvas, clips rays at rim via overflow hidden
    .hero-grain (z-index 5)
    .hero-frost (z-index 6)
  .framer-hero-content (z-index 10) — label, h1, sub, CTA — unaffected
  .dashboard-section (z-index 12, margin-top ~108px) — app card sits BELOW horizon rim
```

Z-index stack is critical: rays behind planet, grain/frost above rays but below content.

### D. Visual Acceptance Criteria

From user request, must have:
- [ ] Sharp rays visible — not just soft glows. Ask user: "Do you see distinct shafts?"
- [ ] Green palette: light green cores, dark green edges. Dark → light transition present.
- [ ] Rays appear to emanate from behind the sphere's horizon (not from random top positions).
- [ ] No hard-edged triangles / dark rectangles overlapping rays.
- [ ] Planet horizon line fully above app mock — capture screenshot, measure pixel distance: rim y < app card top y by at least 24px on 1280px viewport.
- [ ] No regression: nav pills, CTA buttons, title still readable, no performance drop.

Nice-to-have (don't block):
- Very subtle grain matching COSMOQ.
- Rays have slight inner bright core (mint/white) to enhance sharpness.

---

## Implementation Steps (no code yet — review before execute)

1. **Confirm canvas baseline**
   - Keep current clean file (canvas-only). Delete unused `.aurora*` css.

2. **Fix horizon geometry**
   - Update `.hero-backdrop { height: 1080px }`
   - Update `.planet { top: 860px; width: 4200px; height: 4200px; margin-left: -2100px }`
   - Update `.dashboard-section { margin: 96px auto 0 }` stays but ensure visual gap via backdrop height; if needed, `margin-top: 120px`.
   - Screenshot and measure: planet rim y vs dashboard top y.

3. **Rebuild canvas rays (main work)**
   - Rewrite `#auroraCanvas` script to implement Option 1 as described.
   - Keep star field (existing, works).
   - Implement function `drawTaperedRay(ctx, {x, wBottom, wTop, h, tiltDeg, colorStops})` that uses offscreen canvas + horizontal mask to guarantee feathered edges.
   - Define 6 rays with green palette, distinct heights, slight tilts.
   - Draw order: stars → washes (broad low-alpha) → rays (narrow brighter) → horizon base glow.
   - Use `globalCompositeOperation = 'lighter'` (or `screen`) but ensure only light colors fed (no `rgba(2,44,34,0.62)` dark that subtracts — use brighter mids).

4. **Manual QA**
   - `pnpm` screenshots at 1280×900 and 390×844
   - Verify no triangles in either
   - Verify rays are sharp + visible
   - Verify horizon above app mock

5. **Handoff**
   - Show two screenshots side-by-side: before vs after, plus COSMOQ reference
   - Ask user to confirm rays color/sharpness before adding animation back

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Rays still produce faint rect edges | Use offscreen + `destination-in` mask, not solid rects; only use radial gradients whose edges are fully transparent |
| Dark green too dark → invisible on black, or creates dark subtraction with `lighter` | Use minimum luminance: all ray colors `g >= 70`, not near-black. Dark side should be at least `rgb(4,61,48)` with alpha 0.35, not `rgba(2,20,20)` |
| Canvas blur performance on large retina displays | Limit canvas to `min(dpr,2)`, no CSS filter blur, just gradient feathering. Keep RAF at 1fps for static (or disable animation loop — draw once) |
| Planet rim still overlaps app on small laptop screens | Use `@media` to move planet down further on <=1024px, and ensure dashboard margin-top responsive |
| Color looks too saturated vs COSMOQ's muted filmic look | After sharp rays work, add final film grain overlay and subtle vignette, reduce alpha 10-15% |

---

## Out of Scope / Follow-ups

- Add subtle animation (drift, flicker) after static version approved — will use transform-only anim on canvas (no re-draw of heavy gradients every frame) to avoid reintroducing artifacts.
- Brighten dashboard mock — currently almost unreadable; needs separate pass.
- Add Features / How it works sections below — blocked until hero is final.

---

## Questions for Reviewer (you)

1. Ray style: do you want rays to be very narrow and sharp like searchlights (COSMOQ leans this way, ~4-6° width) or wider soft curtains? Current plan goes medium: ~12-18% bottom width, feathered, to stay green and not look like laser pointers.
2. Color split: stick to single green family for all rays (dark emerald left → mint right) or introduce a subtle 2-tone as in COSMOQ (warm left / cool right) adapted to greens (e.g. left more yellow-green #052E1A, right more cyan-green #A7F3D0)? Plan currently does dark emerald left → mint right gradient as requested.
3. Horizon line color: keep thin emerald-white rim or match COSMOQ's thick white bloom? Suggest staying thin emerald for now, as thicker white competes with rays.

Please approve or suggest changes before I implement.
