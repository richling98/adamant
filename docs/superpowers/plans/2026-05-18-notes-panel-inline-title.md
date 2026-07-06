# Notes Panel Inline Meeting Title — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static "My Notes" heading in the Notes panel header with the meeting's real title, editable inline on click, synced to the sidebar on save.

**Architecture:** Add a `handleRenameMeetingTitle(newTitle)` function to `useMeetingData` that accepts the title directly (avoiding the stale-closure problem of the existing `handleSaveMeetingTitle`). Pass it as `onRenameTitle` into `NotesPanel`. Inside `NotesPanel`, toggle between a hover-affordance heading and a focused `<input>` using local `isEditingTitle` state.

**Tech Stack:** React 18, TypeScript, Tauri `invoke`, Tailwind CSS, existing `MEETING_PANE_TITLE_CLASS` from `paneHeaderStyles.ts`

---

## End Result

When a user opens any existing meeting, the Notes panel header displays the meeting's real name instead of the generic "My Notes" label. Hovering over the title reveals a subtle background highlight and a pencil icon. Clicking the title replaces the heading with a text input pre-filled with the current name. The user edits the name and presses Enter (or clicks elsewhere) — the title saves instantly, snaps back to a heading, and the sidebar updates to the new name without any page reload or navigation. Pressing Escape cancels the edit and restores the original name. Submitting an empty title is rejected and the original name is restored. For brand-new notes that haven't been saved yet, the header shows "Untitled Note" in muted grey and clicking it does nothing — renaming becomes available the moment the note is first persisted.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/hooks/meeting-details/useMeetingData.ts` | Add `handleRenameMeetingTitle(newTitle: string)` — direct-title rename that bypasses stale-closure issue |
| `frontend/src/components/NotesPanel.tsx` | Add `onRenameTitle` prop + `isEditingTitle`/`localTitle` local state + editable heading JSX |
| `frontend/src/app/meeting-details/page-content.tsx` | Wire `onRenameTitle={meetingData.handleRenameMeetingTitle}` into `<NotesPanel>` |

---

## Task 1 — Add `handleRenameMeetingTitle` to `useMeetingData`

**Files:**
- Modify: `frontend/src/hooks/meeting-details/useMeetingData.ts`

### Why a new function?

`handleSaveMeetingTitle` (the existing function) reads `meetingTitle` from its `useCallback` closure. Calling `handleTitleChange(newTitle)` then immediately `handleSaveMeetingTitle()` would save the *old* title because React state updates are asynchronous. A function that receives the new title as a parameter sidesteps this entirely.

- [ ] **Step 1.1 — Add `handleRenameMeetingTitle` callback**

Open `frontend/src/hooks/meeting-details/useMeetingData.ts`. After the existing `handleSaveMeetingTitle` callback (~line 85), add:

```typescript
const handleRenameMeetingTitle = useCallback(async (newTitle: string) => {
  const trimmed = newTitle.trim();
  if (!trimmed) return;
  try {
    await invokeTauri('api_save_meeting_title', {
      meetingId: meeting.id,
      title: trimmed,
    });
    setMeetingTitle(trimmed);
    setIsTitleDirty(false);
    const updatedMeetings = sidebarMeetings.map((m: CurrentMeeting) =>
      m.id === meeting.id ? { id: m.id, title: trimmed } : m
    );
    setMeetings(updatedMeetings);
    setCurrentMeeting({ id: meeting.id, title: trimmed });
  } catch (error) {
    console.error('Failed to rename meeting title:', error);
  }
}, [meeting.id, sidebarMeetings, setMeetings, setCurrentMeeting]);
```

- [ ] **Step 1.2 — Export it from the hook's return object**

In the `return { ... }` block at the bottom of `useMeetingData`, add `handleRenameMeetingTitle` alongside the other handlers:

```typescript
return {
  // ... existing fields ...
  handleTitleChange,
  handleSummaryChange,
  handleSaveSummary,
  handleSaveMeetingTitle,
  handleRenameMeetingTitle,   // ← add this line
  saveAllChanges,
  updateMeetingTitle,
};
```

- [ ] **Step 1.3 — Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 1.4 — Commit**

```bash
git add frontend/src/hooks/meeting-details/useMeetingData.ts
git commit -m "feat: add handleRenameMeetingTitle to useMeetingData"
```

---

## Task 2 — Add `onRenameTitle` prop + editable title UI to `NotesPanel`

**Files:**
- Modify: `frontend/src/components/NotesPanel.tsx`

- [ ] **Step 2.1 — Extend `NotesPanelProps`**

In `frontend/src/components/NotesPanel.tsx`, find the `NotesPanelProps` interface (~line 20) and add one prop:

```typescript
interface NotesPanelProps {
  meetingId: string;
  createdAt?: string;
  isNewNote: boolean;
  draftMeetingId: string | null;
  onMeetingCreated?: (actualMeetingId: string) => void;
  onContentPresenceChange?: (hasContent: boolean) => void;
  onMarkdownChange?: (markdown: string) => void;
  onBlocksChange?: (blocks: Block[] | null) => void;
  meetingTitle?: string;          // ← add
  onRenameTitle?: (newTitle: string) => Promise<void>;  // ← add
}
```

- [ ] **Step 2.2 — Destructure the new props in the component signature**

Find the `forwardRef` function signature (~line 89). Add `meetingTitle` and `onRenameTitle` to the destructured props:

```typescript
export const NotesPanel = forwardRef<NotesPanelRef, NotesPanelProps>(function NotesPanel({
  meetingId,
  createdAt,
  isNewNote,
  draftMeetingId,
  onMeetingCreated,
  onContentPresenceChange,
  onMarkdownChange,
  onBlocksChange,
  meetingTitle,       // ← add
  onRenameTitle,      // ← add
}, ref) {
```

- [ ] **Step 2.3 — Add local editing state**

After the existing state declarations (~line 108), add:

```typescript
const [isEditingTitle, setIsEditingTitle] = useState(false);
const [localTitle, setLocalTitle] = useState(meetingTitle ?? '');
```

- [ ] **Step 2.4 — Sync `localTitle` when `meetingTitle` prop changes**

After the state declarations, add a `useEffect` so that when the parent updates `meetingTitle` (e.g. AI summary auto-names the meeting), the local copy stays in sync — but only when not actively editing:

```typescript
useEffect(() => {
  if (!isEditingTitle) {
    setLocalTitle(meetingTitle ?? '');
  }
}, [meetingTitle, isEditingTitle]);
```

- [ ] **Step 2.5 — Add `handleTitleSave` callback**

After the `useEffect` from step 2.4, add the save handler:

```typescript
const handleTitleSave = useCallback(async () => {
  const trimmed = localTitle.trim();
  setIsEditingTitle(false);
  if (!trimmed || trimmed === meetingTitle) {
    setLocalTitle(meetingTitle ?? '');
    return;
  }
  await onRenameTitle?.(trimmed);
}, [localTitle, meetingTitle, onRenameTitle]);
```

Note: `setIsEditingTitle(false)` fires first for immediate UI feedback; the async save completes in the background.

- [ ] **Step 2.6 — Replace the static `<h2>My Notes</h2>` with the editable title**

Find the header JSX (~line 596–601):

```tsx
<div className="min-w-0 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
  <h2 className={MEETING_PANE_TITLE_CLASS}>My Notes</h2>
  {formattedCreatedDate && (
    <span className="text-sm text-foreground/55 whitespace-nowrap">
      created on: {formattedCreatedDate}
    </span>
  )}
</div>
```

Replace it with:

```tsx
<div className="min-w-0 flex flex-col gap-0.5">
  {/* Draft note: not yet persisted, title not editable */}
  {isDraftMeeting ? (
    <h2 className={`${MEETING_PANE_TITLE_CLASS} text-foreground/40`}>Untitled Note</h2>
  ) : isEditingTitle ? (
    /* Editing state: focused input */
    <input
      className="bg-white/[0.07] border border-emerald-400/60 rounded-md px-2 py-0.5 text-lg font-semibold text-foreground outline-none max-w-[280px] w-full"
      value={localTitle}
      autoFocus
      onChange={(e) => setLocalTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleTitleSave(); }
        if (e.key === 'Escape') { setLocalTitle(meetingTitle ?? ''); setIsEditingTitle(false); }
      }}
      onBlur={handleTitleSave}
    />
  ) : (
    /* Resting state: heading with hover affordance */
    <button
      type="button"
      className="group flex items-center gap-1.5 rounded px-1 -ml-1 hover:bg-white/[0.05] transition-colors text-left"
      onClick={() => { setLocalTitle(meetingTitle ?? ''); setIsEditingTitle(true); }}
      title="Click to rename"
    >
      <h2 className={MEETING_PANE_TITLE_CLASS}>{meetingTitle || 'Untitled Note'}</h2>
      <span className="text-foreground/30 text-sm opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        ✏
      </span>
    </button>
  )}
  {formattedCreatedDate && (
    <span className="text-sm text-foreground/55 whitespace-nowrap">
      created on: {formattedCreatedDate}
    </span>
  )}
</div>
```

- [ ] **Step 2.7 — Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 2.8 — Commit**

```bash
git add frontend/src/components/NotesPanel.tsx
git commit -m "feat: add inline-editable meeting title to NotesPanel header"
```

---

## Task 3 — Wire `onRenameTitle` in `page-content.tsx`

**Files:**
- Modify: `frontend/src/app/meeting-details/page-content.tsx`

- [ ] **Step 3.1 — Pass props to `<NotesPanel>`**

Find the `<NotesPanel>` call site (~line 484). Add two props:

```tsx
<NotesPanel
  ref={notesPanelRef}
  meetingId={meeting.id}
  createdAt={meeting.created_at}
  isNewNote={isNewNote}
  draftMeetingId={draftMeetingId}
  onMeetingCreated={onMeetingCreated}
  onContentPresenceChange={setHasNotesContent}
  onMarkdownChange={setLiveNotesMarkdown}
  onBlocksChange={setLiveNotesBlocks}
  meetingTitle={meetingData.meetingTitle}                        // ← add
  onRenameTitle={meetingData.handleRenameMeetingTitle}           // ← add
/>
```

- [ ] **Step 3.2 — Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3.3 — Commit**

```bash
git add frontend/src/app/meeting-details/page-content.tsx
git commit -m "feat: wire meetingTitle and onRenameTitle into NotesPanel"
```

---

## Task 4 — Manual verification

- [ ] **Step 4.1 — Start the app**

```bash
cd frontend && ./clean_run.sh
```

- [ ] **Step 4.2 — Test: resting state**

Open any existing meeting. The Notes panel header should show the meeting's real name (not "My Notes"). No pencil icon visible until hover.

- [ ] **Step 4.3 — Test: hover state**

Hover over the title. A subtle background highlight and pencil icon (✏) should appear. Cursor should be a text cursor.

- [ ] **Step 4.4 — Test: rename and save with Enter**

Click the title. Input appears, pre-filled with current name. Type a new name. Press Enter. Verify:
- Heading snaps back immediately with the new name
- Sidebar updates to the new name without a page reload
- Navigating away and back still shows the new name (persisted)

- [ ] **Step 4.5 — Test: rename and save with blur**

Click the title, change the name, then click anywhere else in the app. Same result as Enter.

- [ ] **Step 4.6 — Test: Escape cancels**

Click the title, type something. Press Escape. The original name should be restored, no save occurs.

- [ ] **Step 4.7 — Test: empty title rejected**

Click the title, clear all text, press Enter. The original name should be restored (no empty title saved).

- [ ] **Step 4.8 — Test: draft / new note**

Navigate to a new note (`?id=new`). The header should show "Untitled Note" in muted grey. Clicking it should do nothing (no input appears).

- [ ] **Step 4.9 — Test: existing rename paths still work**

Rename a meeting via the AI Cleanup panel (if that path still exists) or via the sidebar. Confirm the Notes panel title updates to match.

- [ ] **Step 4.10 — Final commit if any polish was needed**

```bash
git add -p
git commit -m "fix: polish inline title edge cases"
```
