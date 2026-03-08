# Fix Note Persistence Bug (ADA-2)

## Context

**Problem**: When users create a manual note and type content, the auto-save (2-second debounce) successfully saves to the database but the typed content immediately disappears from the editor, replaced with a blank note.

**Root Cause**: After a new note is saved, the app calls `router.replace()` to update the URL from `?id=new` to `?id=meeting-abc123`. This URL change triggers React to update the `meetingId` and `isNewNote` props passed to NotesPanel. When these props change, NotesPanel's `useEffect([meetingId, isNewNote])` dependency array fires, causing the component to reinitialize its state.

The critical issue is that `useCreateBlockNote()` is called on every render with an `initialContent` prop. When the props change after save, the editor is recreated with outdated or empty initial content, losing the user's typed text even though it was saved to the database.

**Why Previous Fixes Failed**:
- `justSavedRef` flag: Prevents database reload but doesn't prevent editor recreation with stale content
- `useEffect` to update editor: Caused infinite loop (594,700+ messages)
- Sidebar refresh: Helps but doesn't address the editor content loss

**User Requirement**: High confidence solution - no more guessing, must address actual root cause.

## Solution: Content Preservation with Ref and editor.replaceBlocks()

**Approach**: Preserve the editor content in a ref that survives re-renders, then restore it using BlockNote's `editor.replaceBlocks()` API when the editor is recreated after prop changes.

**Why This Works**:
1. **Refs survive re-renders** - `editorContentRef` will hold the latest blocks even when props change
2. **BlockNote API for content updates** - `editor.replaceBlocks()` updates content without recreating the editor
3. **Proven pattern** - Same approach used in `BlockNoteSummaryView.tsx` (lines 94-95)
4. **No timing issues** - Direct content restoration, no race conditions

## Implementation Steps

### 1. Add Content Preservation Ref

**File**: `frontend/src/components/NotesPanel.tsx`
**Location**: After line 60 (after `justSavedRef` declaration)

```typescript
const justSavedRef = useRef<boolean>(false);
const editorContentRef = useRef<Block[] | null>(null); // NEW: Preserve content across re-renders
```

**Purpose**: Store the current editor blocks so they survive prop changes and re-renders.

### 2. Update Content Ref on Every Change

**File**: `frontend/src/components/NotesPanel.tsx`
**Location**: Line 262 (inside `handleEditorChange` function)

**Current code**:
```typescript
const handleEditorChange = () => {
  const blocks = editor.document;
  setNoteContent(blocks);
  // ... rest of function
};
```

**Change to**:
```typescript
const handleEditorChange = () => {
  const blocks = editor.document;
  setNoteContent(blocks);
  editorContentRef.current = blocks; // NEW: Preserve in ref
  // ... rest of function
};
```

**Purpose**: Keep the ref synchronized with the latest editor content on every keystroke.

### 3. Preserve Content Before URL Transition

**File**: `frontend/src/components/NotesPanel.tsx`
**Location**: Line 147 (inside `saveNote` function, just before calling `onMeetingCreated`)

**Current code**:
```typescript
justSavedRef.current = true;
if (onMeetingCreated) {
  onMeetingCreated(newMeetingId);
}
```

**Change to**:
```typescript
justSavedRef.current = true;
editorContentRef.current = blocks; // NEW: Ensure we have the saved content in ref
if (onMeetingCreated) {
  onMeetingCreated(newMeetingId);
}
```

**Purpose**: Guarantee the ref contains the just-saved content before the URL change triggers prop updates.

### 4. Restore Content After Prop Change

**File**: `frontend/src/components/NotesPanel.tsx`
**Location**: Lines 293-299 (in the `loadNote` useEffect, after the `justSavedRef` check)

**Current code**:
```typescript
if (justSavedRef.current) {
  console.log('🔍 DEBUG Skipping load (just saved, editor already has content)');
  justSavedRef.current = false;
  return;
}
```

**Change to**:
```typescript
if (justSavedRef.current) {
  console.log('🔍 DEBUG Skipping load (just saved, restoring content from ref)');
  justSavedRef.current = false;

  // NEW: Restore content using BlockNote API
  if (editorContentRef.current && editor) {
    editor.replaceBlocks(editor.document, editorContentRef.current);
    console.log('✅ Content restored from ref:', editorContentRef.current.length, 'blocks');
  }
  setIsEditorReady(true);
  return;
}
```

**Purpose**: When the URL changes and props update, restore the preserved content using BlockNote's content replacement API instead of letting the editor initialize with stale or empty content.

### 5. Initialize Ref on Database Load

**File**: `frontend/src/components/NotesPanel.tsx`
**Location**: Line 320 (after successfully loading note from database)

**Current code**:
```typescript
setNoteContent(data.content_json);
setNoteVersion(data.version || 1);
console.log('✅ Note loaded successfully');
```

**Change to**:
```typescript
setNoteContent(data.content_json);
editorContentRef.current = data.content_json; // NEW: Keep ref in sync
setNoteVersion(data.version || 1);
console.log('✅ Note loaded successfully');
```

**Purpose**: When loading existing notes from database, ensure the ref is synchronized so future saves have the correct baseline.

## Critical Files

| File | Purpose | Changes |
|------|---------|---------|
| `frontend/src/components/NotesPanel.tsx` | Note editor component | 5 modifications: add ref, update on change, preserve before save, restore after prop change, sync on load |
| `frontend/src/components/AISummary/BlockNoteSummaryView.tsx` | Reference pattern | No changes - shows proven `editor.replaceBlocks()` usage |

## Verification Steps

### 1. Start the App
```bash
cd /Users/rling/Personal\ projects/meeting-minutes/frontend
source ~/.cargo/env
pnpm run tauri:dev
```

### 2. Test Basic Persistence
1. Open DevTools (Cmd+Shift+I)
2. Click pencil icon (✏️) to create new note
3. Type: "Testing content persistence"
4. Wait 2-3 seconds for auto-save
5. **Expected**: Content stays visible (not blank)
6. **Check console for**: `✅ Content restored from ref: 2 blocks`

### 3. Test Navigation Persistence
1. Create note with content: "Navigate away test"
2. Wait for auto-save (see "Saved" indicator)
3. Click Home button
4. Click the note in sidebar to reopen
5. **Expected**: Content "Navigate away test" is still there

### 4. Test No Blank Notes
1. Click pencil icon
2. Don't type anything
3. Wait 3 seconds
4. Click Home
5. **Expected**: No new blank note in sidebar

### 5. Test Multiple Edits
1. Create note: "First edit"
2. Wait for save
3. Add text: "Second edit"
4. Wait for save
5. Navigate away and back
6. **Expected**: Both edits preserved: "First edit Second edit"

### Success Criteria
- ✅ Typed content stays visible after auto-save
- ✅ No blank editor after "Saved" indicator appears
- ✅ Content persists across navigation
- ✅ Console shows `✅ Content restored from ref: N blocks`
- ✅ No console errors or infinite loops

## Edge Cases Handled

1. **User types during save**: `editorContentRef` updates on every keystroke, so latest content is always preserved
2. **Multiple rapid saves**: Ref is updated before each `onMeetingCreated` callback, ensuring sync
3. **Database load fails**: Ref remains null, editor shows empty state (existing error handling applies)
4. **User navigates during auto-save**: `justSavedRef` flag ensures restore logic only runs once per save
5. **Editor not ready**: Check `editor` exists before calling `replaceBlocks()`

## Rollback Plan

If issues arise, revert with:
```bash
cd /Users/rling/Personal\ projects/meeting-minutes
git diff frontend/src/components/NotesPanel.tsx
git checkout frontend/src/components/NotesPanel.tsx
cd frontend && pnpm run tauri:dev
```

## Why This Solution Has High Confidence

1. **Addresses actual root cause**: Preserves content across editor recreation, not just database reloads
2. **Uses proven pattern**: Same `editor.replaceBlocks()` API used successfully in BlockNoteSummaryView.tsx
3. **Minimal changes**: Only 5 small additions to one file, all in NotesPanel.tsx
4. **No architectural changes**: Works with existing routing and state management
5. **No timing dependencies**: Direct content restoration, no delays or polling
6. **Easy to test**: Clear console logs show exactly when restoration happens
7. **Easy to rollback**: All changes isolated to single component
8. **Handles edge cases**: Ref pattern naturally handles rapid edits, navigation, and errors
