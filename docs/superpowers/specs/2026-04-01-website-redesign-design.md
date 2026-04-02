# Website Redesign: Stoic Minimalist

**Date:** 2026-04-01
**File:** `website/index.html`

## TLDR

Redesign the Adamant landing page from flashy/marketing to stoic and developer-focused. Linear/Vercel aesthetic: dark background, neutral grays, green only on the primary CTA, no animations or glow effects.

## Design Decisions

**Aesthetic:** Linear/Vercel-style dark. The current page has radial glows, gradient text, animated badges, scroll-reveal animations, and a glowing green CTA button. All of these are removed. The result should feel like quality developer tooling — calm, precise, trustworthy.

**Color palette:**
- Background: `#0a0a0a`
- Surface/cards: `#111111`
- Borders: `#1a1a1a`
- Text primary: `#ffffff`
- Text secondary: `#999999`
- Text muted: `#555555`
- Accent (CTA only): `#10b981`

**Typography:** Inter. Headlines `font-weight: 600`, `letter-spacing: -0.5px`. Body `font-weight: 400`, `color: #999`. Section labels: `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.5px`, `color: #555`.

**Animations:** None. No fade-up, no pulse, no scroll-reveal, no hover transforms (except subtle color transitions on links).

## End Result

The user sees a clean, dark landing page that loads instantly and communicates the product's value without visual noise. The hero has a headline, a one-line description, a green Download button + plain GitHub link, and a simplified app mockup below. Scrolling reveals three numbered steps, a feature grid, and a one-line footer. A developer visiting the page should feel like they're reading good documentation, not a SaaS marketing site.

## Page Structure

### 1. Nav (fixed)
- Left: logo image + "Adamant" wordmark
- Center-right: `How it works` · `Features` · `GitHub` (text links, `color: #555`, hover `#fff`)
- Far right: `Download for Mac` — green button (`background: #10b981`, `color: #fff`, no box-shadow)
- Background: `rgba(10,10,10,0.9)` with `backdrop-filter: blur(12px)`, bottom border `1px solid #1a1a1a`

### 2. Hero
- Badge removed. No animated pill.
- Headline: `AI meeting assistant. Everything stays on your Mac.` — two lines, `font-size: clamp(2rem, 5vw, 3.5rem)`, `font-weight: 600`, `letter-spacing: -1px`, `color: #fff`. Plain white, no gradient.
- Subtext: `Record, transcribe, summarize — entirely on your Mac. No cloud. No bots. No subscriptions.` — `color: #666`, `font-size: 1.1rem`
- CTAs: `↓ Download for Mac` (green filled) + `View on GitHub` (plain border, `#1a1a1a` border, `#999` text)
- App mockup: simplified macOS window chrome (three traffic-light dots in `#222`, no colors), sidebar with meeting list, main panel showing a sample summary. Dark grays only, no green highlights inside the mockup.

### 3. How it works
- Section label: `HOW IT WORKS`
- Three numbered steps in a row: `01 Record`, `02 Transcribe`, `03 Summarize`
- Each step: number in `#333`, title in `#fff`, one-sentence description in `#555`
- No connector lines, no icons, no step circles with borders

### 4. Features
- Section label: `FEATURES`
- 3×2 grid of plain cards
- Each card: feature name (`#fff`, `font-weight: 500`) + one-line description (`#555`)
- Card background `#111`, border `1px solid #1a1a1a`, border-radius `6px`, padding `20px`
- Hover: border color lightens to `#2a2a2a` only — no transform, no shadow
- Features to include:
  1. Local transcription — Whisper.cpp runs on-device. No audio ever leaves your Mac.
  2. AI summaries — Ollama, Claude, Groq, or OpenRouter. Your LLM, your choice.
  3. Private by default — No cloud, no accounts, no telemetry.
  4. Folders & search — Organize meetings into folders. Full-text search across all transcripts.
  5. Apple Silicon — Optimized for M-series chips with Metal GPU acceleration.
  6. Open source — MIT license. Self-hostable. Read the code.

### 5. Footer
- Single line, centered: `Adamant · MIT License · GitHub · © 2025`
- `color: #333`, `font-size: 13px`
- Top border `1px solid #1a1a1a`

## What Gets Removed vs Current Page

| Removed | Replacement |
|---|---|
| `hero-glow` radial gradient | Plain dark background |
| `gradient-text` on headline | Plain white text |
| Animated pulse badge | Nothing |
| `green-glow` box-shadow on CTA | Flat green button |
| `grid-bg` grid pattern | Nothing |
| Scroll-reveal `.reveal` animations | Static content |
| FAQ accordion section | Removed entirely |
| Step connector lines | Removed |
| Card hover `translateY(-2px)` | Border color change only |
| `window-chrome` colored traffic dots | Neutral `#222` dots |

## Implementation Notes

- Single `website/index.html` file — no build step, no external JS beyond Tailwind CDN
- Keep Tailwind CDN for utility classes, but override with `<style>` block for anything Tailwind can't express cleanly
- Keep the existing `downloadLatest()` JS function and GitHub star fetch — only the visual layer changes
- Keep all existing nav anchor links (`#how-it-works`, `#features`)
- Remove the FAQ section and its JS accordion logic entirely
- The app mockup is pure HTML/CSS — no images needed
