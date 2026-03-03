# Feature Implementation Plan: Manual Note-Taking with BlockNote Editor

**Overall Progress:** `0%`

**Linear Issue:** [ADA-1](https://linear.app/richard-ling/issue/ADA-1/add-manual-note-taking-feature-with-notion-like-markdown-editor)

## TLDR

Add manual note-taking capability to Meetily, allowing users to create notes-only meetings or attach recordings to existing notes. Users can type thoughts, questions, and observations in a BlockNote editor (Notion-like experience) alongside AI transcriptions. Notes are displayed in a **third panel (NotesPanel)** alongside the existing TranscriptPanel and SummaryPanel in a three-column layout. Notes are stored separately, autosaved every 2 seconds using lodash.debounce, and persist across sessions.

## Critical Decisions

* **Decision 1: Three-Panel Layout (Notes | Transcript | Summary)** - Add NotesPanel as a third panel in the side-by-side layout. Keeps existing TranscriptPanel and SummaryPanel unchanged. Notes panel positioned on the left, allowing users to see all three views simultaneously or toggle between them.

* **Decision 2: BlockNote Editor (Reuse Existing)** - Leverage the already-integrated BlockNote editor used for summaries. Provides Notion-like slash commands, markdown shortcuts, and block manipulation out-of-the-box. Zero new dependencies, consistent UX. Initialize with one empty paragraph block.

* **Decision 3: New `meeting_notes` Table with Versioning** - Create dedicated table for user notes separate from transcripts. Supports autosave snapshots, edit history, and clear separation of concerns. Schema: `id`, `meeting_id` (FK), `content_json`, `content_markdown`, `version`, `created_at`, `updated_at`.

* **Decision 4: Debounced Autosave with lodash.debounce** - Auto-save notes 2 seconds after user stops typing using `lodash.debounce` (already available in package.json). Backend PATCH endpoint updates `meeting_notes` table incrementally.

* **Decision 5: Lazy Meeting Creation** - Meeting record created on first edit or recording start, not on pencil button click. Prevents empty meetings cluttering the database. Frontend handles "draft" state until persistence.

* **Decision 6: meeting_id Parameter for Recording Attachment** - Add `meeting_id: Option<String>` parameter to `start_recording` Tauri command. When user creates notes first then starts recording, pass existing meeting ID so transcripts attach to the same meeting (not create new one).

* **Decision 7: No Sidebar Icons** - Removed sidebar visual indicators for notes-only vs recorded meetings. Users discover meeting content by clicking and viewing panels. Reduces UI clutter.

* **Decision 8: Clean Up Unused notes/[id] Route** - Delete unused `frontend/src/app/notes/[id]/page.tsx` (static sample data only). Add redirect from `/notes/[id]` → `/meeting-details?id=[id]` for consistency.

## Tasks

- [ ] 🟥 **Step 1: Database Schema - Create `meeting_notes` Table**
  - [ ] 🟥 Add migration in `backend/app/db.py` → `_legacy_init_db()` to create `meeting_notes` table with columns: `id` (TEXT PRIMARY KEY), `meeting_id` (TEXT FK), `content_json` (TEXT), `content_markdown` (TEXT), `version` (INTEGER DEFAULT 1), `created_at` (TEXT), `updated_at` (TEXT)
  - [ ] 🟥 Add index on `meeting_id` for fast lookups: `CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting_id ON meeting_notes(meeting_id)`
  - [ ] 🟥 Add foreign key constraint: `FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE`
  - [ ] 🟥 Update `DatabaseManager` class to include `meeting_notes` in schema validation

- [ ] 🟥 **Step 2: Backend API - Notes CRUD Endpoints**
  - [ ] 🟥 Add Pydantic models in `backend/app/main.py`: `MeetingNote` (response), `CreateNoteRequest` (create), `UpdateNoteRequest` (patch)
  - [ ] 🟥 Implement `POST /api/meetings/{meeting_id}/notes` - Create initial note (returns note_id), stores both JSON and markdown
  - [ ] 🟥 Implement `GET /api/meetings/{meeting_id}/notes` - Fetch current note (latest version), returns `content_json` for BlockNote
  - [ ] 🟥 Implement `PATCH /api/meetings/{meeting_id}/notes` - Update note (debounced autosave endpoint), increments version, updates `updated_at`
  - [ ] 🟥 Add database methods in `DatabaseManager`: `create_meeting_note()`, `get_meeting_note()`, `update_meeting_note()`

- [ ] 🟥 **Step 3: Frontend - Add Pencil Button to Home Page**
  - [ ] 🟥 Modify `frontend/src/app/page.tsx` - Add pencil button next to microphone button in `RecordingControls` section (line ~234)
  - [ ] 🟥 Style pencil button: white background, gray border, `Pencil` icon from `lucide-react`, tooltip "New Note"
  - [ ] 🟥 Add click handler: `router.push('/meeting-details?id=new')` - navigates to meeting-details (notes panel will be visible by default)
  - [ ] 🟥 Add button positioning: use same `flex` container as microphone button, separated by vertical divider

- [ ] 🟥 **Step 4: Frontend - Detect "New Note" Mode in Meeting Details**
  - [ ] 🟥 Modify `frontend/src/app/meeting-details/page.tsx` - Check URL param `id=new` in `MeetingDetailsContent` component
  - [ ] 🟥 Add state: `const [isNewNote, setIsNewNote] = useState(meetingId === 'new')` - tracks draft mode
  - [ ] 🟥 Add state: `const [draftMeetingId, setDraftMeetingId] = useState<string | null>(null)` - holds temporary ID until persisted
  - [ ] 🟥 Skip `fetchMeetingDetails` API call when `id=new` - prevent 404 error
  - [ ] 🟥 Initialize empty meeting object: `{ id: 'new', title: 'Untitled Note', transcripts: [] }` when `id=new`

- [ ] 🟥 **Step 5: Frontend - Create NotesPanel Component**
  - [ ] 🟥 Create new file: `frontend/src/components/MeetingDetails/NotesPanel.tsx`
  - [ ] 🟥 Component structure: Similar to TranscriptPanel/SummaryPanel with header, BlockNote editor, and button group
  - [ ] 🟥 Props: `meetingId`, `isNewNote`, `onNotesSaved` (callback after first save), `onMeetingIdUpdate` (update parent with real ID)
  - [ ] 🟥 Header section: Show "Meeting Notes" title, autosave indicator ("Saving..." / "Saved ✓"), save button (Cmd+S shortcut)
  - [ ] 🟥 Editor section: BlockNote editor with placeholder "Type '/' for commands, '###' for headings..."

- [ ] 🟥 **Step 6: Frontend - Integrate BlockNote Editor in NotesPanel**
  - [ ] 🟥 Import `Editor` component from `@/components/BlockNoteEditor/Editor`
  - [ ] 🟥 Add state: `const [noteBlocks, setNoteBlocks] = useState<Block[]>([{ type: 'paragraph', content: '' }])` - initialize with one empty paragraph block
  - [ ] 🟥 Add state: `const [isSaving, setIsSaving] = useState(false)` - tracks save status
  - [ ] 🟥 Add state: `const [lastSaved, setLastSaved] = useState<Date | null>(null)` - timestamp of last successful save
  - [ ] 🟥 Fetch existing notes on mount: `useEffect(() => { if (meetingId !== 'new') fetchNotes() }, [meetingId])`
  - [ ] 🟥 Implement `fetchNotes()`: Call `GET /api/meetings/{meetingId}/notes`, parse `content_json` to blocks, set `noteBlocks` state
  - [ ] 🟥 Render editor: `<Editor initialContent={noteBlocks} onChange={handleNoteChange} editable={true} />`

- [ ] 🟥 **Step 7: Frontend - Implement Autosave Logic with lodash.debounce**
  - [ ] 🟥 Import: `import { debounce } from 'lodash'` at top of NotesPanel.tsx
  - [ ] 🟥 Create debounced save function: `const debouncedSave = useCallback(debounce(async (blocks: Block[]) => { await saveNotes(blocks); }, 2000), [])`
  - [ ] 🟥 Implement `handleNoteChange(blocks: Block[])`: Call `debouncedSave(blocks)` to trigger autosave after 2s of inactivity
  - [ ] 🟥 Implement `saveNotes(blocks: Block[])`:
    - Set `isSaving(true)` and show "Saving..." indicator
    - Convert blocks to markdown using BlockNote's `blocksToMarkdownLossy()`
    - If `isNewNote`, create meeting first via `POST /api/meetings` with title "Untitled Note", then create note via `POST /api/meetings/{id}/notes`
    - If existing meeting, update via `PATCH /api/meetings/{meetingId}/notes` with `content_json` and `content_markdown`
    - On success: Update `lastSaved`, show "Saved ✓" briefly (2s), then hide indicator
    - On failure: Show error toast with retry button
  - [ ] 🟥 Handle first save: After creating meeting, call `onMeetingIdUpdate(actualId)`, then `router.replace('/meeting-details?id=' + actualId)` to update URL without page reload
  - [ ] 🟥 Cleanup: Cancel debounced save on unmount: `useEffect(() => { return () => debouncedSave.cancel(); }, [])`

- [ ] 🟥 **Step 8: Frontend - Add NotesPanel to page-content.tsx Layout**
  - [ ] 🟥 Modify `frontend/src/app/meeting-details/page-content.tsx` - Import `NotesPanel` component
  - [ ] 🟥 Update layout: Change from 2-panel to 3-panel grid: `<div className="flex flex-1 overflow-hidden">`
    - Add `<NotesPanel />` as first child (left panel)
    - Keep `<TranscriptPanel />` as second child (middle panel)
    - Keep `<SummaryPanel />` as third child (right panel)
  - [ ] 🟥 Adjust panel widths: Use flexbox or grid to allocate space (e.g., `w-1/3` for each, or adjustable with resize handles)
  - [ ] 🟥 Pass props to NotesPanel: `meetingId={meeting.id}`, `isNewNote={meeting.id === 'new'}`, callbacks for updates
  - [ ] 🟥 Conditional rendering: Always show NotesPanel for all meetings (even if no notes exist yet - empty state handled inside component)

- [ ] 🟥 **Step 9: Rust Backend - Add meeting_id Parameter to start_recording**
  - [ ] 🟥 Modify `frontend/src-tauri/src/lib.rs` → `start_recording` function signature:
    - Add parameter: `meeting_id: Option<String>` (after existing `meeting_name` parameter)
  - [ ] 🟥 Update `audio::recording_commands::start_recording_with_devices_and_meeting` call to pass `meeting_id`
  - [ ] 🟥 Modify `frontend/src-tauri/src/audio/recording_commands.rs` → `start_recording_with_devices_and_meeting`:
    - Add `meeting_id: Option<String>` parameter
    - Store `meeting_id` in recording state if provided
    - When saving transcripts, use existing `meeting_id` instead of generating new one if `meeting_id.is_some()`
  - [ ] 🟥 Update transcript saving logic: If `meeting_id` exists, call backend with that ID; otherwise create new meeting with `meeting_name`

- [ ] 🟥 **Step 10: Frontend - Handle Recording Attachment to Notes**
  - [ ] 🟥 Modify `frontend/src/components/RecordingControls.tsx` - Add optional prop: `existingMeetingId?: string`
  - [ ] 🟥 Update `handleStartRecording()`: If `existingMeetingId` is provided, pass it to `invoke('start_recording', { ..., meeting_id: existingMeetingId })`
  - [ ] 🟥 Modify `frontend/src/app/page.tsx` → `handleRecordingStart()`:
    - Check URL for `?id=` parameter to detect if recording from meeting-details page
    - If on meeting-details with existing meeting, pass `meeting_id` to RecordingControls
  - [ ] 🟥 After recording stops: Transcripts saved to same `meeting_id`, appear in TranscriptPanel, notes remain in NotesPanel, title unchanged

- [ ] 🟥 **Step 11: Backend - Support Notes-Only Meeting Creation**
  - [ ] 🟥 Add new endpoint in `backend/app/main.py`: `POST /api/meetings` (without transcripts)
    - Request body: `{ "title": string }`
    - Creates meeting record with auto-generated ID, no transcripts
    - Returns: `{ "id": string, "title": string, "created_at": string }`
  - [ ] 🟥 Modify `DatabaseManager.save_meeting()` - Handle case where `transcripts=[]` (empty list allowed)
  - [ ] 🟥 Update `POST /api/save-transcripts` validation: Accept empty `transcripts` array, create meeting entry only

- [ ] 🟥 **Step 12: Frontend - Clean Up Unused notes/[id] Route**
  - [ ] 🟥 Delete file: `frontend/src/app/notes/[id]/page.tsx` (unused static sample)
  - [ ] 🟥 Add redirect: Create `frontend/src/app/notes/[id]/route.ts` with redirect logic:
    ```typescript
    import { redirect } from 'next/navigation';
    export async function GET(request: Request, { params }: { params: { id: string } }) {
      redirect(`/meeting-details?id=${params.id}`);
    }
    ```
  - [ ] 🟥 Test: Verify `/notes/abc-123` redirects to `/meeting-details?id=abc-123` without breaking anything

- [ ] 🟥 **Step 13: Edge Cases - Handle Concurrent Edits & Loss Prevention**
  - [ ] 🟥 Add `beforeunload` event listener in NotesPanel: Warn user if unsaved changes exist (check dirty flag)
  - [ ] 🟥 Implement dirty flag: Track if `noteBlocks` differ from last saved version (`isDirty` state)
  - [ ] 🟥 Show warning on navigation: "You have unsaved notes. Leave anyway?" (only if `isDirty === true`)
  - [ ] 🟥 Add version conflict detection: Backend checks `version` on PATCH, returns 409 Conflict if stale
  - [ ] 🟥 Handle 409 conflict: Show modal "Note was updated elsewhere. Reload to see latest version?" with reload button

- [ ] 🟥 **Step 14: Polish - Add Keyboard Shortcuts & UX Improvements**
  - [ ] 🟥 Add `Cmd+S` / `Ctrl+S` shortcut in NotesPanel: Trigger immediate save (bypass debounce, call `saveNotes()` directly)
  - [ ] 🟥 Add keyboard listener: `useEffect(() => { const handler = (e) => { if (e.metaKey && e.key === 's') { e.preventDefault(); saveNotes(); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [])`
  - [ ] 🟥 Add loading state when fetching notes: Show skeleton loader while `isLoading === true`
  - [ ] 🟥 Add empty state: If `noteBlocks.length === 1 && noteBlocks[0].content === ''`, show placeholder hint in editor
  - [ ] 🟥 Visual polish: Fade in "Saved ✓" indicator, show timestamp "Last saved 2m ago" on hover

- [ ] 🟥 **Step 15: Testing - Verify Core Flows**
  - [ ] 🟥 Test: Create notes-only meeting → Type notes → Autosave triggers → Close app → Reopen → Notes persisted
  - [ ] 🟥 Test: Create notes → Start recording from meeting-details → Stop → Transcripts appear in TranscriptPanel, notes intact in NotesPanel
  - [ ] 🟥 Test: Start recording first → Navigate to meeting-details → Add notes → Both transcripts and notes saved to same meeting
  - [ ] 🟥 Test: Type notes quickly → Debounce delays save → Wait 2s → "Saving..." indicator appears → "Saved ✓" confirmation
  - [ ] 🟥 Test: Navigate away with unsaved changes → Warning shown → Cancel navigation preserves edits, Continue discards
  - [ ] 🟥 Test: Open existing meeting → Notes load correctly → Edit → Autosave updates → Refresh page → Changes persisted
  - [ ] 🟥 Test: `/notes/abc-123` redirects to `/meeting-details?id=abc-123` correctly

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

---

**Implementation Notes:**

- **Three-Panel Layout**: NotesPanel (left) | TranscriptPanel (middle) | SummaryPanel (right) - all visible simultaneously
- **No Scope Creep**: Notes are NOT included in AI summary generation (as specified in Linear issue)
- **Reuse Existing**: BlockNote editor, existing panels architecture, lodash.debounce
- **Minimal Backend Changes**: Only adds `meeting_notes` table + 3 endpoints (POST, GET, PATCH) + 1 meeting creation endpoint
- **Zero New Dependencies**: No new libraries needed (lodash already available, BlockNote already integrated)

**Risk Mitigations:**

- **Data Loss**: Autosave (2s debounce) + beforeunload warning + version tracking prevents loss
- **Empty Meetings**: Lazy creation (on first edit) prevents DB clutter
- **Performance**: Debounced saves minimize API calls, indexed queries on `meeting_id`
- **Recording Attachment**: `meeting_id` parameter ensures transcripts attach to correct meeting
- **Concurrent Edits**: Version conflict detection (409 response) prevents data corruption

Update the overall progress percentage and step statuses as work progresses.
