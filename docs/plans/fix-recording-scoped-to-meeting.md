# Fix: Recording Must Be Scoped to Its Originating Meeting

**Overall Progress:** `0%`

---

## TLDR

When a recording starts on meeting A and the user navigates to meeting B, meeting B shows
the live recording indicator, live transcripts, and stop/pause controls — because
`RecordingStateContext.isRecording` is a global boolean with no meeting ID attached. Every
meeting page that reads this context sees `isRecording = true` regardless of which meeting
owns the recording.

The fix is minimal and surgical: add `recordingMeetingId` to `RecordingStateContext`, set it
when recording starts, and gate all recording-related UI in `page-content.tsx` with
`isRecording && recordingMeetingId === meeting.id`. Two files changed, zero new infrastructure.

---

## Root Cause: Full Trace

### Why the indicator appears on the wrong meeting

`RecordingStateContext` tracks `isRecording: boolean`. It has no concept of which meeting owns
the recording. When meeting A starts a recording:

```
RecordingStateContext.isRecording = true   (global)
```

When the user navigates to meeting B, `page-content.tsx` mounts fresh and reads:

```typescript
const { isRecording } = useRecordingState(); // → true, always
```

Meeting B then passes `isRecording={true}` to `<TranscriptPanel>`, which renders the recording
indicator, the live transcript stream, and the Stop / Pause buttons — all scoped to the wrong
meeting.

### Why stopping from the wrong meeting corrupts state

`handleStopRecordingOnPage` on meeting B runs:

```typescript
setPostRecordingSnapshot([...liveTranscripts]); // captures meeting A's live transcripts
toast.loading('Saving transcript...', { id: 'transcript-save' });
handleRecordingStop({ source: 'ui', callApi: true });
```

`handleRecordingStop` uses `pendingMeetingId` (still set to meeting A's ID) to save — so
the transcripts land in meeting A correctly. But meeting B's UI now shows meeting A's
transcript snapshot, the save toast, and the post-recording state. After saving, the
`meeting-transcripts-updated` event fires with meeting A's ID; meeting B's listener ignores
it (wrong ID); meeting B is left in a broken half-state with stale snapshot content.

### Why the auto-stop listener also fires on the wrong meeting

The silence auto-stop `useEffect` in `page-content.tsx` has `[]` deps. When the user
navigates from A to B:

1. Meeting A unmounts → listener cleaned up ✓
2. Meeting B mounts → new listener registered

When `recording-auto-stopped` fires, meeting B's freshly-mounted listener calls
`handleStopRecordingOnPage()` — same corruption as the manual stop case.

---

## End Result

After this fix:

- The recording indicator (pulsing dot, Stop button, Pause button, live transcript stream)
  appears **only on the meeting that started the recording**
- Navigating to any other meeting shows a completely normal, non-recording view of that meeting
- Pressing End Recording from the wrong meeting page is silently ignored — the button is not
  even shown
- The auto-stop silence monitor fires correctly on whichever page is mounted, but the handler
  is guarded so only the owning meeting processes the stop
- No regressions to the tray stop, keyboard stop, or classic home-page recording flows

---

## Critical Decisions

- **Store `recordingMeetingId` in `RecordingStateContext`**, not in `TranscriptContext` or a
  separate store. `RecordingStateContext` is already the single source of truth for all
  recording state — keeping this here is consistent and avoids cross-context coupling.

- **Set `recordingMeetingId` in `handleStartRecordingOnPage`**, not in the backend-event
  listener. The meeting ID is known at the moment the user presses Start on a specific page —
  this is the right place to claim ownership.

- **Clear `recordingMeetingId` in the `recording-stopped` event handler** inside
  `RecordingStateContext` — this guarantees it's cleared regardless of how recording stops
  (UI, tray, keyboard, auto-stop, or crash recovery).

- **Derive `isRecordingForThisMeeting`** in `page-content.tsx` as a local computed value —
  `isRecording && recordingMeetingId === meeting.id`. Don't change the meaning of the global
  `isRecording` — other parts of the app that need to know "is anything recording?" still use
  the unscoped global.

- **Use a ref to track `recordingMeetingId`** inside the auto-stop `useEffect` (which has
  `[]` deps). A ref is always current inside the stale closure, so the guard reads the live
  value even though the effect was set up at mount.

- **Two files only.** `RecordingStateContext.tsx` and `page-content.tsx`. No other files
  require changes for this fix.

---

## Tasks

---

- [ ] 🟥 **Step 1: Add `recordingMeetingId` to `RecordingStateContext`**

  **File:** `frontend/src/contexts/RecordingStateContext.tsx`

  **1a. Extend the `RecordingState` interface:**
  ```typescript
  interface RecordingState {
    isRecording: boolean;
    isPaused: boolean;
    isActive: boolean;
    recordingDuration: number | null;
    activeDuration: number | null;
    status: RecordingStatus;
    statusMessage?: string;
    recordingMeetingId: string | null;   // ← ADD THIS
  }
  ```

  **1b. Extend the `RecordingStateContextType` interface:**
  ```typescript
  interface RecordingStateContextType extends RecordingState {
    setStatus: (status: RecordingStatus, message?: string) => void;
    setRecordingMeetingId: (id: string | null) => void;   // ← ADD THIS
    isStopping: boolean;
    isProcessing: boolean;
    isSaving: boolean;
  }
  ```

  **1c. Initialize with `null` in the initial state:**
  ```typescript
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    isActive: false,
    recordingDuration: null,
    activeDuration: null,
    status: RecordingStatus.IDLE,
    statusMessage: undefined,
    recordingMeetingId: null,   // ← ADD THIS
  });
  ```

  **1d. Add `setRecordingMeetingId` callback:**
  ```typescript
  const setRecordingMeetingId = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, recordingMeetingId: id }));
  }, []);
  ```

  **1e. Clear `recordingMeetingId` when the `recording-stopped` event fires:**

  In the existing `onRecordingStopped` handler inside `setupListeners`:
  ```typescript
  const unlistenStopped = await recordingService.onRecordingStopped((payload) => {
    setState(prev => {
      const newStatus = [...] // existing logic unchanged
      return {
        ...prev,
        status: newStatus,
        statusMessage: ...,
        isRecording: false,
        isPaused: false,
        isActive: false,
        recordingDuration: null,
        activeDuration: null,
        recordingMeetingId: null,   // ← ADD THIS LINE
      };
    });
    stopPolling();
  });
  ```

  **1f. Expose in `contextValue`:**
  ```typescript
  const contextValue = useMemo(() => ({
    ...state,
    setStatus,
    setRecordingMeetingId,   // ← ADD THIS
    isStopping: state.status === RecordingStatus.STOPPING,
    isProcessing: state.status === RecordingStatus.PROCESSING_TRANSCRIPTS,
    isSaving: state.status === RecordingStatus.SAVING,
  }), [state, setStatus, setRecordingMeetingId]);
  ```

  - [ ] 🟥 Extend `RecordingState` interface with `recordingMeetingId: string | null`
  - [ ] 🟥 Extend `RecordingStateContextType` with `setRecordingMeetingId`
  - [ ] 🟥 Initialize `recordingMeetingId: null` in initial state
  - [ ] 🟥 Add `setRecordingMeetingId` useCallback
  - [ ] 🟥 Clear `recordingMeetingId: null` in the `recording-stopped` event handler
  - [ ] 🟥 Add `setRecordingMeetingId` to `contextValue`

---

- [ ] 🟥 **Step 2: Set `recordingMeetingId` when recording starts in `page-content.tsx`**

  **File:** `frontend/src/app/meeting-details/page-content.tsx`

  **2a. Destructure `setRecordingMeetingId` from `useRecordingState()`:**
  ```typescript
  const recordingState = useRecordingState();
  const { isRecording, setRecordingMeetingId } = recordingState;
  ```

  **2b. In `handleStartRecordingOnPage`, set the meeting ID before starting:**
  ```typescript
  const handleStartRecordingOnPage = useCallback(async () => {
    let meetingIdToUse: string = meeting.id;

    if (meeting.id === 'new') {
      const timestamp = ...
      const meetingData = await invoke('api_create_meeting', { title: `Meeting ${timestamp}` }) as ...;
      meetingIdToUse = meetingData.id;
      onMeetingCreated?.(meetingIdToUse);
    }

    setPostRecordingSnapshot([]);
    clearTranscripts();
    setPendingMeetingId(meetingIdToUse);

    // Claim ownership of this recording for this meeting BEFORE starting
    setRecordingMeetingId(meetingIdToUse);   // ← ADD THIS LINE

    await handleRecordingStart();
  }, [
    meeting.id,
    onMeetingCreated,
    setPendingMeetingId,
    clearTranscripts,
    handleRecordingStart,
    setRecordingMeetingId,   // ← ADD TO DEPS
  ]);
  ```

  - [ ] 🟥 Destructure `setRecordingMeetingId` from `useRecordingState()`
  - [ ] 🟥 Call `setRecordingMeetingId(meetingIdToUse)` in `handleStartRecordingOnPage` before `handleRecordingStart()`
  - [ ] 🟥 Add `setRecordingMeetingId` to `handleStartRecordingOnPage` dependency array

---

- [ ] 🟥 **Step 3: Derive `isRecordingForThisMeeting` and gate all recording UI**

  **File:** `frontend/src/app/meeting-details/page-content.tsx`

  **3a. Compute the scoped recording flag:**
  ```typescript
  // True only when a recording is active AND it belongs to this specific meeting.
  // isRecording (global) stays true for "is anything recording?" checks elsewhere.
  const isRecordingForThisMeeting =
    isRecording && recordingState.recordingMeetingId === meeting.id;

  const isStoppingForThisMeeting =
    recordingState.isStopping && recordingState.recordingMeetingId === meeting.id;
  ```

  **3b. Replace `isRecording` with `isRecordingForThisMeeting` in all JSX and memos:**

  | Location | Old | New |
  |----------|-----|-----|
  | `hasTranscriptContent` memo | `isRecording` | `isRecordingForThisMeeting` |
  | `hasCleanupSourceContent` (derived) | (unchanged — uses `hasTranscriptContent`) | — |
  | `TranscriptPanel` prop | `isRecording={isRecording}` | `isRecording={isRecordingForThisMeeting}` |
  | `TranscriptPanel` prop | `isStopping={recordingState.isStopping}` | `isStopping={isStoppingForThisMeeting}` |
  | `TranscriptPanel` prop | `disableAutoScroll={!isRecording}` | `disableAutoScroll={!isRecordingForThisMeeting}` |
  | `TranscriptPanel` transcripts source | `isRecording ? liveTranscripts : ...` | `isRecordingForThisMeeting ? liveTranscripts : ...` |
  | `TranscriptPanel` prop | `usePagination={!isRecording && ...}` | `usePagination={!isRecordingForThisMeeting && ...}` |
  | `TranscriptPanel` segments prop | `(!isRecording && ...) ? segments : undefined` | `(!isRecordingForThisMeeting && ...) ? segments : undefined` |

  **3c. Fix the toast dismiss effect:**
  ```typescript
  useEffect(() => {
    if (!recordingState.isStopping) {  // keep global — toast should dismiss when stop finishes anywhere
      toast.dismiss('transcript-save');
    }
  }, [recordingState.isStopping]);
  ```
  This is fine as-is — the `transcript-save` toast is only shown by this meeting's
  `handleStopRecordingOnPage`, so global `isStopping` dismiss is correct.

  - [ ] 🟥 Add `isRecordingForThisMeeting` computed const
  - [ ] 🟥 Add `isStoppingForThisMeeting` computed const
  - [ ] 🟥 Update `hasTranscriptContent` memo to use `isRecordingForThisMeeting`
  - [ ] 🟥 Update all 6 `TranscriptPanel` props listed above

---

- [ ] 🟥 **Step 4: Guard `handleStopRecordingOnPage` against wrong-meeting stops**

  **File:** `frontend/src/app/meeting-details/page-content.tsx`

  ```typescript
  const handleStopRecordingOnPage = useCallback(() => {
    // Guard: only the meeting that owns the recording can stop it.
    if (recordingState.recordingMeetingId !== meeting.id) {
      console.warn(
        '[Recording] Ignoring stop request: recording belongs to meeting %s, currently viewing %s',
        recordingState.recordingMeetingId,
        meeting.id,
      );
      return;
    }

    // Existing stop logic unchanged:
    setPostRecordingSnapshot([...liveTranscripts]);
    toast.loading('Saving transcript...', { id: 'transcript-save' });
    handleRecordingStop({ source: 'ui', callApi: true });
    Analytics.trackButtonClick('stop_recording', 'meeting_details_transcript_header');
  }, [
    handleRecordingStop,
    liveTranscripts,
    recordingState.recordingMeetingId,   // ← ADD TO DEPS
    meeting.id,                          // ← ADD TO DEPS
  ]);
  ```

  - [ ] 🟥 Add `recordingMeetingId !== meeting.id` guard at the top of `handleStopRecordingOnPage`
  - [ ] 🟥 Add `recordingState.recordingMeetingId` and `meeting.id` to dependency array

---

- [ ] 🟥 **Step 5: Guard the `recording-auto-stopped` listener**

  **File:** `frontend/src/app/meeting-details/page-content.tsx`

  The silence auto-stop `useEffect` has `[]` deps (intentional — Tauri listener is set up
  once on mount). To read current `recordingMeetingId` inside the stale closure, use a ref.

  **5a. Add a ref that tracks `recordingMeetingId`:**
  ```typescript
  // Always-current ref to recording ownership — readable inside stale closures
  const recordingMeetingIdRef = useRef<string | null>(recordingState.recordingMeetingId);
  useEffect(() => {
    recordingMeetingIdRef.current = recordingState.recordingMeetingId;
  }, [recordingState.recordingMeetingId]);
  ```

  **5b. Add the guard inside the auto-stop listener:**
  ```typescript
  // In the existing silence auto-stop useEffect:
  unlistenStopped = await listen('recording-auto-stopped', () => {
    // Guard: only handle auto-stop if this page owns the recording
    if (recordingMeetingIdRef.current !== meeting.id) {
      console.warn(
        '[Auto-stop] Ignoring: recording belongs to meeting %s, currently viewing %s',
        recordingMeetingIdRef.current,
        meeting.id,
      );
      return;
    }

    toast.dismiss('silence-warning');
    toast.info('Recording automatically stopped after silence', { duration: 5000 });
    handleStopRecordingOnPage();
  });
  ```

  Note: `meeting.id` is captured at mount time and is stable for the lifetime of this
  component instance — it does not change during navigation (navigation unmounts and
  remounts the component). So using it directly in the `[]`-deps closure is safe.

  - [ ] 🟥 Add `recordingMeetingIdRef` ref and sync effect
  - [ ] 🟥 Add `recordingMeetingIdRef.current !== meeting.id` guard inside `recording-auto-stopped` listener
  - [ ] 🟥 Ensure the `recording-silence-warning` toast is similarly guarded (same pattern)

---

## Verification Checklist

After implementing all steps, manually verify these scenarios:

- [ ] 🟥 Start recording on meeting A. Navigate to meeting B. Confirm: meeting B shows **no** recording indicator, no live transcripts, no Stop/Pause buttons.
- [ ] 🟥 Start recording on meeting A. Navigate to meeting B. Navigate back to meeting A. Confirm: meeting A still shows the recording indicator, live transcripts, Stop/Pause buttons correctly.
- [ ] 🟥 Start recording on meeting A. Navigate to meeting B. Press End Recording — confirm: **nothing happens** (button not visible, no state change).
- [ ] 🟥 Start recording on meeting A. Stay on meeting A. Press End Recording. Confirm: recording stops correctly, transcript saves to meeting A, normal post-recording flow.
- [ ] 🟥 Start recording on meeting A. Navigate to meeting B. Wait for silence auto-stop. Confirm: meeting B shows **no** incorrect snapshot or save toast. Meeting A's transcript is saved correctly.
- [ ] 🟥 Verify tray stop still works (backend-initiated stop clears `recordingMeetingId` via `recording-stopped` event, no regressions).

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
