# Fix Plan: Todo Extraction Strictness & TodosPage Display

## Layman's Summary

### What's wrong (root cause)

**Problem 1 -- Fake to-dos from the transcript:** When you run "AI Cleanup" on a meeting, the app tries to extract to-dos. It has two ways to do this: (a) look at your notes for a "to dos" section and grab those items, or (b) ask an AI to read the transcript and find action items. The AI option is supposed to be a fallback, but sometimes it runs even when your notes have a "to dos" section. When it does run, it's too aggressive -- it mistakes things people are *discussing* in the meeting (like "we're investing in insurance" or "we're building a Berkshire-like entity") for things you need to *do* after the meeting. The result is fake to-dos that are just topics from the conversation.

**Problem 2 -- To-dos invisible on the full page:** The homepage shows your to-dos as plain text, which works fine. But when you click "View all" to see them on the dedicated to-dos page, each to-do is shown in a rich-text editor (BlockNote). That editor is initialized from a JSON field (`content_json`), but extracted to-dos only store plain text (`content_markdown`), not JSON. So the editor starts completely empty -- you see the meeting link but not the actual to-do text. It looks like a blank text box.

### How we'll fix it

**Fix 1:** Make the AI extraction extremely conservative. It will only capture things that are unambiguously action items -- someone explicitly saying "I will do X" or "I need to do X after this meeting." Anything that sounds like a discussion topic, business plan, or strategy will be rejected. We'll also add a post-extraction filter that catches common false-positive patterns (like "invest in...", "build a...", "buy a..."). And we'll make sure the notes-based path always runs first -- if your notes have a "to dos" section, the AI never even looks at the transcript.

**Fix 2:** When a to-do has plain text but no JSON, the to-dos page will convert the plain text into BlockNote blocks so the editor displays the actual to-do content. This is the same approach already used elsewhere in the app for loading markdown into BlockNote editors.

---

## Detailed Root Cause Analysis

### Issue 1: Over-Extraction (Fabricated To-Dos from Transcript)

#### Current flow (`todo_extractor.rs`)

```
extract_todos_from_sources()
    |
    |-- Step 1: Try deterministic parser on notes_markdown
    |           extract_todo_section_items(notes) -> Vec<ExtractedTodoItem>
    |
    |-- Step 2: If note_items is empty -> run LLM on transcript
    |           build_extraction_prompt(title, date, transcript)
    |           generate_summary() -> parse JSON -> transcript_items
    |
    |-- Step 3: Delete existing extracted todos for this meeting
    |
    |-- Step 4: Save items to database
```

#### Why the LLM produces false positives

The current system prompt (`todo_extractor.rs:111-122`) says:

> "Only extract commitments where someone explicitly says they will do something after this meeting."

But the LLM (especially smaller local models like Llama) interprets this loosely. In the Bill Ackman transcript, statements like "we're buying an insurance company" and "we're going to build an entity modeled after Berkshire" are interpreted as commitments, even though they're Ackman describing his company's strategy -- not action items for the meeting participant.

The fabricated items:
- "invest in insurance (owner: Pershing Square Funds, deadline: next month or so)" -- Ackman discussing the Vantage acquisition
- "build an entity modeled after berkshire (owner: Pershing Square Funds)" -- Ackman describing the Howard Hughes strategy

These are **discussion topics**, not **post-meeting action items**.

#### Why notes_markdown may not reach the extractor

The `notes_markdown` parameter travels through this chain:

1. Frontend `handleGenerateSummary()` in `useSummaryGeneration.ts:474-484`:
   - Reads `liveNotesMarkdown` (React state, set via `onMarkdownChange` callback from NotesPanel)
   - Falls back to `api_get_note` (fetches persisted `notes_markdown` from `meeting_notes` table)
   - Passes `notesMarkdown || null` to `api_process_transcript`

2. Rust `api_process_transcript` (`commands.rs:179`): receives `notes_markdown: Option<String>`, passes to `process_transcript_background`

3. `process_transcript_background` (`service.rs:369`): clones `notes_markdown`, spawns tokio task

4. `TodoExtractor::extract_todos_from_sources` (`todo_extractor.rs:27`): receives `notes_markdown: Option<&str>`

**Failure modes:**
- `liveNotesMarkdown` may be stale (`''` initial state) if the editor just loaded and `onMarkdownChange` hasn't fired yet
- The `api_get_note` fallback may return empty if autosave (2-second debounce) hasn't persisted yet
- `notesMarkdown || null` converts empty string to `null`, which becomes `None` in Rust
- Even if notes reach the extractor, if the notes markdown doesn't have a recognizable "to dos" heading, `extract_todo_section_items` returns empty and the LLM runs

#### The core design flaw

The current design is **either/or**: deterministic notes parsing OR LLM transcript extraction. When notes parsing fails (for any reason), the LLM runs with no notes context and extracts discussion topics as action items.

The correct design should be:
1. **Always** try deterministic notes parsing first
2. If notes have explicit to-do items, use ONLY those -- never fall back to LLM
3. If notes have NO to-do section, the LLM may run but with an extremely conservative prompt
4. Add a post-extraction filter to reject common false-positive patterns

### Issue 2: TodosPage Not Showing Extracted To-Do Content

#### Current flow (`TodosPage.tsx:240-246`)

```tsx
const initialContent = todo.content_json
    ? (JSON.parse(todo.content_json) as any[])
    : undefined;

const editor = useCreateBlockNote({
    initialContent: initialContent as any,
});
```

#### The problem

Extracted to-dos are saved in `save_todos_to_db` (`todo_extractor.rs:288-295`) with:
```rust
NewTodoItem {
    content_json: None,           // <-- Always None for extracted items
    content_markdown: Some(source_text.clone()),  // Text stored here
    source_text: Some(item.text.clone()),          // And here
    ...
}
```

When `content_json` is `None`:
1. `initialContent` becomes `undefined`
2. `useCreateBlockNote({ initialContent: undefined })` creates an empty editor
3. The BlockNote editor renders as a blank text box
4. The to-do text (stored in `content_markdown` / `source_text`) is invisible

#### Why the homepage works but TodosPage doesn't

The homepage (`page.tsx:237`) displays to-dos as plain text:
```tsx
{todo.content_markdown || todo.source_text || "Untitled"}
```

This works because it reads `content_markdown` directly. But TodosPage uses a BlockNote editor that only initializes from `content_json`.

#### The existing pattern for this fix

`BasicBlockNoteTest.tsx:23-29` and `BlockNoteSummaryView.tsx:165-177` already do this:
```tsx
const blocks = await editor.tryParseMarkdownToBlocks(markdown);
editor.replaceBlocks(editor.document, blocks);
```

We need to apply the same pattern in `TodoRow` when `content_json` is null.

---

## Implementation Plan

### Step 1: Fix LLM extraction prompt to be extremely conservative

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`
**Function:** `build_extraction_prompt()`

Changes to the system prompt:
- Require EXPLICIT commitment language: "I will", "I need to", "I should", "let's make sure to", "remind me to", "after this meeting I'll", "we need to", "I plan to"
- Explicitly EXCLUDE: business strategies, corporate actions (mergers, acquisitions, investments), things companies are doing as part of their operations, discussion topics, opinions, facts, announcements
- Add concrete examples of what NOT to extract (from the user's actual case)
- Require that the action is something a MEETING PARTICIPANT would do after the meeting, not something a third-party company is doing
- Emphasize: "When in doubt, leave it out. An empty array is always better than a false positive."

New system prompt:
```
You are an action-item extractor for personal to-do lists. Your task is to read a meeting transcript and extract ONLY unambiguous, explicit post-meeting action items that a meeting participant needs to do after this meeting.

Return ONLY a JSON array of objects, each with exactly these fields:
  "text": a clear, self-contained description of the action item (max 120 characters)
  "owner": the person responsible (null if not explicitly stated)
  "deadline": any specific deadline mentioned (null if not stated)

STRICT INCLUSION CRITERIA -- the item MUST meet ALL of these:
1. Someone explicitly uses commitment language: "I will", "I need to", "I should", "let's make sure to", "remind me to", "after this meeting I'll", "I plan to", "we need to", "I'm going to" (in the context of a personal task, not a corporate strategy)
2. The action is something a meeting participant would personally do after the meeting (e.g., "email John", "research X", "follow up with Y", "schedule a meeting with Z")
3. The action is NOT already happening -- it's a future task

ABSOLUTE EXCLUSIONS -- never extract these:
- Business strategies, corporate plans, or company operations ("we're investing in insurance", "we're building a Berkshire-like entity", "we're buying a company")
- Things companies are doing as part of their business ("they are acquiring Vantage", "the transaction should close next month")
- Discussion topics, opinions, facts, or announcements
- Questions, hypothetical scenarios, or examples
- Things someone says they already do or have done
- General statements about plans without explicit personal commitment language

When in doubt, leave it out. An empty array is always better than a false positive.

Output ONLY valid JSON. No preamble, no explanation, no markdown fences.
```

### Step 2: Add post-extraction filter for LLM items

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`
**New function:** `filter_llm_items()`

After the LLM returns items, apply a deterministic filter that rejects items matching common false-positive patterns:

```rust
fn filter_llm_items(items: Vec<ExtractedTodoItem>) -> Vec<ExtractedTodoItem> {
    items.into_iter().filter(|item| {
        let text_lower = item.text.to_lowercase();
        
        // Reject items that start with corporate action verbs
        // (these are discussion topics, not personal action items)
        const CORPORATE_PATTERNS: &[&str] = &[
            "invest in", "build a", "build an", "buy a", "buy an",
            "acquire", "merge with", "develop a", "develop an",
            "launch a", "launch an", "create a", "create an",
            "establish a", "establish an", "form a", "form an",
        ];
        
        for pattern in CORPORATE_PATTERNS {
            if text_lower.starts_with(pattern) {
                return false;
            }
        }
        
        // Reject items with company/corporate context indicators
        if text_lower.contains("the company will") 
            || text_lower.contains("the firm will")
            || text_lower.contains("pershing square will")
            || text_lower.contains("howard hughes will") {
            return false;
        }
        
        true
    }).collect()
}
```

This is a safety net -- even if the LLM prompt improvements don't fully prevent false positives, the filter catches common patterns.

### Step 3: Add diagnostic logging for notes_markdown

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`
**Function:** `extract_todos_from_sources()`

Add logging at key decision points:

```rust
info!(
    "Todo extraction inputs: meeting={}, transcript_len={}, notes_markdown={:?}, notes_len={}",
    meeting_id,
    transcript_text.len(),
    notes_markdown.is_some(),
    notes_markdown.map(str::len).unwrap_or(0),
);

let note_items = notes_markdown
    .map(|n| {
        info!("Notes markdown preview (first 200 chars): {}", &n[..n.len().min(200)]);
        Self::extract_todo_section_items(n)
    })
    .unwrap_or_default();

info!(
    "Deterministic parsing result: {} items found from notes",
    note_items.len()
);

if !note_items.is_empty() {
    // Log each item
    for (i, item) in note_items.iter().enumerate() {
        info!("  Note item {}: {}", i, item.text);
    }
}
```

This will help diagnose whether notes_markdown is reaching the extractor and whether the deterministic parser is finding items.

### Step 4: Fix TodosPage to display extracted to-do content

**File:** `frontend/src/components/Todos/TodosPage.tsx`
**Component:** `TodoRow`

When `content_json` is null but `content_markdown` (or `source_text`) has content, convert the markdown to BlockNote blocks using `tryParseMarkdownToBlocks` and populate the editor via `replaceBlocks` in a `useEffect`.

```tsx
function TodoRow({ todo, ... }: { ... }) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  
  // Determine the display text for extracted todos without content_json
  const displayMarkdown = todo.content_json
    ? null  // content_json exists, use it directly
    : (todo.content_markdown || todo.source_text || "");
  
  const initialContent = todo.content_json
    ? (JSON.parse(todo.content_json) as any[])
    : undefined;

  const editor = useCreateBlockNote({
    initialContent: initialContent as any,
  });

  // If no content_json but we have markdown text, parse it into blocks
  // and load into the editor. This is the same pattern used in
  // BlockNoteSummaryView.tsx and BasicBlockNoteTest.tsx.
  useEffect(() => {
    if (!displayMarkdown || !displayMarkdown.trim()) return;
    
    let cancelled = false;
    const loadMarkdown = async () => {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(displayMarkdown);
        if (!cancelled && blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch (err) {
        console.error("Failed to parse todo markdown to blocks:", err);
      }
    };
    loadMarkdown();
    
    return () => { cancelled = true; };
  }, [editor, displayMarkdown]);

  // ... rest of component unchanged
}
```

Key details:
- `displayMarkdown` is derived from `content_markdown` or `source_text` only when `content_json` is null
- The `useEffect` runs once when the component mounts (or when `displayMarkdown` changes)
- `tryParseMarkdownToBlocks` is an async BlockNote API that converts markdown text to BlockNote block objects
- `editor.replaceBlocks` replaces the editor's content with the parsed blocks
- The `cancelled` flag prevents race conditions if the component unmounts before the async operation completes

### Step 5: Ensure notes_markdown is always passed from frontend

**File:** `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`
**Function:** `handleGenerateSummary()`

Add a more robust fallback chain:

```typescript
let notesMarkdown = liveNotesMarkdown.trim();

// If live notes are empty, try fetching from database
if (!notesMarkdown) {
  try {
    const noteData = await invokeTauri('api_get_note', { meetingId: meeting.id }) as any;
    const persistedNotes = noteData?.content_markdown?.trim() ?? '';
    notesMarkdown = persistedNotes;
  } catch {
    // Notes are optional
  }
}

// Debug log to verify notes are being passed
console.debug('Notes markdown for todo extraction:', {
  length: notesMarkdown.length,
  preview: notesMarkdown.substring(0, 100),
  hasTodoSection: /###\s*(to.?do|action.?item|follow.?up)/i.test(notesMarkdown),
});
```

This adds a diagnostic log that shows whether notes contain a to-do section, helping identify if the issue is in the frontend or backend.

---

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src-tauri/src/summary/todo_extractor.rs` | Steps 1, 2, 3 -- stricter LLM prompt, post-extraction filter, diagnostic logging |
| `frontend/src/components/Todos/TodosPage.tsx` | Step 4 -- load markdown into BlockNote editor when content_json is null |
| `frontend/src/hooks/meeting-details/useSummaryGeneration.ts` | Step 5 -- diagnostic logging for notes_markdown |

## Testing Checklist

1. **Over-extraction test:** Run AI cleanup on a meeting with a transcript that discusses business strategies. Verify that discussion topics are NOT extracted as to-dos.
2. **Notes section test:** Create a meeting with notes containing a `### to dos` section. Run AI cleanup. Verify that ONLY the notes' to-do items are extracted (LLM does not run).
3. **No notes test:** Run AI cleanup on a meeting with no notes. Verify that the LLM only extracts explicit action items, not discussion topics.
4. **TodosPage display test:** After extraction, click "View all" on the homepage. Verify that the to-do text is visible in the BlockNote editor on the TodosPage.
5. **Manual todo test:** Create a manual to-do on the TodosPage. Verify it displays correctly.
6. **Toggle test:** Toggle a to-do on both the homepage and TodosPage. Verify the checkbox state syncs.
7. **Regeneration test:** Run AI cleanup twice on the same meeting. Verify that old extracted to-dos are replaced (no duplicates).
