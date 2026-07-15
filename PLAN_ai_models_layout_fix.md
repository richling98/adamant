# Fix: Your AI Models Onboarding Layout — Dropdown Clipping + Side-by-Side Columns

## Your Screenshot Verification

From `/Users/richardling/Desktop/Screenshot 2026-07-10 at 12.51.39 AM.png`:

- Top card: **Transcription Engine** with dropdown open (`Parakeet v3 int8 (Recommended)` selected).
- Bottom card: **Summary Engine** with `Gemma 3 1B`.
- Bug: The transcription dropdown's option list is rendered **behind** the summary engine card rectangle, cutting off `Parakeet v2 int8` row. Second card paints after first card in DOM, so it covers the first card's absolute dropdown even though dropdown has `z-30`.
- Second issue: The green pill `Download ~1.0 GB` button under Summary Engine is left-aligned, small, with a lot of empty space to its right.

## Your Request (Restated)

1. **Fix the dropdown hiding bug**: Transcription Engine dropdown must appear *over* the Summary Engine card, not behind it. Can see all options.

2. **Refactor to two columns instead of two rows**: 
   - Instead of stacked vertical cards (flex-col with space-y-5), lay out Transcription Engine and Summary Engine **side-by-side** (two columns).
   - This inherently avoids the overlap conflict — dropdowns pop down within their own column and don't intersect the other card's bounding box as much (and even if they slightly overflow, they are side-by-side so vertical overflow doesn't hit the other card).
   - Cleaner visual organization.

3. **Fix the Download button alignment**:
   - Originally left-aligned.
   - First thought: center it.
   - Refined thought: Since cards will now be vertically oriented (taller, columnar layout), make the download button **full-width (minus a small buffer)** at the bottom of each card.
   - So: button stretches almost entire card width, with natural padding buffer (e.g., `w-full` inside card that already has `p-5`, so it's automatically buffered).
   - Dropdown won't conflict because cards are now columns.

## Root Cause Analysis

File: `frontend/src/components/onboarding/steps/DownloadProgressStep.tsx`

- Layout: Lines 606-637:
  ```tsx
  <div className="w-full max-w-lg space-y-5">
    {renderModelCard(Mic... Transcription Engine...)}
    {renderModelCard(Sparkles... Summary Engine...)}
  </div>
  ```
  This is `flex-col` implicitly via `space-y-5`. Stacked rows.

- Each card in `renderModelCard` (L409-527):
  ```tsx
  <div className="relative rounded-xl border ... overflow-visible w-full">
  ```
  `overflow-visible` is correct, but stacking context issue: both cards are `relative` with no z-index. When first card's dropdown (`absolute z-30`) opens, second card (later sibling) paints on top in stacking order. Need either parent z-index boost when open, or side-by-side layout to avoid.

- Download button (L494-503):
  ```tsx
  <div className="mt-4">
    <button className="inline-flex items-center gap-2 ...">
  ```
  `inline-flex` + no centering = left-aligned pill. Not `w-full`.

## Proposed Solution

### 1. Change Container from Rows to Columns

**Current:**
```tsx
<div className="flex flex-col items-center w-full space-y-5">
  <div className="w-full max-w-lg space-y-5">
    Card1
    Card2
  </div>
</div>
```

**New:**
```tsx
<div className="flex flex-col items-center w-full">
  <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-5">
    Card1
    Card2
  </div>
</div>
```

- `max-w-lg` (512px) is too narrow for two columns. Change to `max-w-3xl` or `max-w-4xl` (~768-896px) to accommodate side-by-side.
- `grid-cols-1 md:grid-cols-2` keeps mobile responsiveness: single column on small screens, side-by-side on `md`+.
- Alternatively use `lg:grid-cols-2` if you want to be more conservative, but `md` is better for typical onboarding window size (~800px).
- Gap `gap-5` similar to existing `space-y-5` but both axes.

### 2. Fix Stacking Context for Dropdown Safety Even After Column Change

Even in 2-col, dropdown could still overlap slightly if many options (max-h-80). Add defensive z-index:

- In `renderModelCard`, add dynamic z-index based on whether dropdown is open:
  ```tsx
  <div className={`relative ... ${isDropdownOpen ? 'z-50' : 'z-0'}`}>
  ```
  Or set first card to `z-10` when open and second to `z-0`, etc.

- Or increase dropdown itself to `z-50` (currently `z-30`) and ensure card wrapper doesn't create isolating stacking context that prevents crossing.

- Because cards will be side-by-side, the transcription dropdown opening downward will no longer intersect summary card vertically (they are at same vertical origin), so overlap almost eliminated. Still add z-10 boost for summary dropdown opening to avoid clipping by window edges.

### 3. Make Download Button Full-Width with Buffer at Bottom

**Current button container:**
```tsx
{state.status === 'waiting' && (
  <div className="mt-4">
    <button className="inline-flex ... px-4 py-2">
      Download {size}
    </button>
  </div>
)}
```

**New:**
```tsx
{state.status === 'waiting' && (
  <div className="mt-auto pt-4">
    <button className="flex w-full items-center justify-center gap-2 rounded-lg ... px-4 py-2.5">
      <Download className="h-4 w-4" />Download {size}
    </button>
  </div>
)}
```

- Change wrapper to `mt-auto pt-4` so it sticks to bottom of card flex column.
- Change button to `flex w-full justify-center` instead of `inline-flex`.
- Keep green pill styling: `border border-lime-300/40 bg-lime-400/10 ... hover:bg-lime-400/20`
- Because card itself has `p-5` padding, `w-full` automatically leaves buffer — natural look. Requirement says "not the full width, but leave a little bit of a buffer" — this satisfies because parent padding is the buffer. Alternatively add `mx-0.5` or keep as full within padded area.
- Make cards equal height: add `h-full` and parent grid with `items-stretch` or add `flex flex-col` to card itself: `className="relative ... flex flex-col h-full"`.

### 4. Card Internal Flex Layout for Bottom-Anchored Button

Update `renderModelCard` root div to be flex column:

```tsx
<div className="relative rounded-xl border ... flex flex-col h-full p-4 sm:p-5 overflow-visible w-full">
```

And the top content section (`flex items-start gap-3`) stays as is, but add `flex-1` to description area or use `flex flex-col flex-1`.

Combine with `mt-auto` for download button ensures button always at bottom even when descriptions differ length.

### 5. Edge Cases

- **Downloading state**: Progress bar currently in `mt-4` — also should be `mt-auto pt-4` to stay bottom-aligned. Keep `w-full` already.
- **Error state**: Similarly bottom-aligned.
- **Mobile**: In single column mode (grid-cols-1), full-width button still looks good.
- **Dropdown still visible**: On mobile stacked, original overlapping issue returns. So conditional z-index boost (`z-40` when dropdown open) solves mobile case. Add:
  ```tsx
  <div className={`relative ... ${isDropdownOpen ? 'z-20' : ''}`}>
  ```
  And dropdown remains `z-50`.

### 6. Files to Modify

- **Single file**: `frontend/src/components/onboarding/steps/DownloadProgressStep.tsx`
  - `renderModelCard` function signature: potentially add param for card class or handle via wrapper.
  - Container layout change at lines 606-637.
  - Button styling changes at lines 494-503.
  - Card root div class changes at line 410.
  - Add conditional z-index logic.

No other files needed unless you want to adjust `OnboardingContainer` max-width.

### 7. Testing Checklist

- Open onboarding (reset with dev flag or localStorage clear).
- Click Transcription Engine dropdown — verify all 8 options visible, not clipped behind Summary card.
- Verify two-column layout on desktop (≥768px) side-by-side.
- Verify single-column fallback on mobile narrow (<768px).
- Verify Download buttons are full-width with padding buffer, centered/justified, at bottom of each card.
- Click Summary dropdown — verify it also overlaps cleanly (z-index).
- Verify Download buttons still trigger `triggerTranscriptionDownload` / `triggerSummaryDownload`.
- Verify progressing / error states keep bottom alignment.
- Check dark mode visuals (existing classes use zinc/lime, should be same).

## Visual Mockup Description

```
Before (rows):
+-------------------------------+
| Transcription Engine          |
| [Dropdown ▼]                  |
| (dropdown hidden behind ↓)    |
+-------------------------------+
+-------------------------------+
| Summary Engine                |
| [Dropdown ▼]                  |
| [Download ~1.0 GB] (left)     |
+-------------------------------+

After (columns):
+-----------------------------------------------+
|  +---------------------+ +-------------------+ |
|  | Transcription       | | Summary Engine    | |
|  | [Dropdown ▼ full]   | | [Dropdown ▼ full] | |
|  | desc...             | | desc...           | |
|  |                     | |                   | |
|  | [Download full-w]   | | [Download full-w] | |
|  +---------------------+ +-------------------+ |
+-----------------------------------------------+
```

Dropdowns now open without crossing the other card's rectangle vertically.
