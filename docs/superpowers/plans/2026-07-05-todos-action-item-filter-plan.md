# Fix Plan: Deterministic To-Do Parser Action-Item Filtering

## Layman's Summary

### What's wrong (root cause)

When you write notes with a `### to dos` section, the app extracts every single line under that heading as a to-do -- no questions asked. It doesn't check whether each line is actually an action item. So when you wrote:

- `research how many rings the boston celtics had` → real to-do (starts with "research")
- `find out erling haaland's record in the world cup` → real to-do (starts with "find out")
- `bill russelll player center in the celtics` → **statement, not a to-do** (no action verb)
- `why isn't neymar that good anymore` → **question, not a to-do** (starts with "why")
- `figure out why all norway soccer players are so tall` → real to-do (starts with "figure out")
- `this is NOT a to do, please don't put it in the "to do" section` → **meta-commentary, not a to-do**

All 6 were blindly extracted. The parser has a "heading detector" (finds `### to dos`) and a "line cleaner" (strips bullet points), but **no action-item filter** -- it never asks "does this line actually describe something to do?"

### How we'll fix it

Add an `is_action_item()` filter function that checks whether each line looks like a real to-do. A real to-do starts with an **action verb in imperative mood** (e.g., "research", "find out", "figure out", "email", "call", "schedule"). Lines that are questions (start with "why", "how", "what", etc.), meta-commentary ("this is NOT a to do"), or statements without action verbs will be rejected. The golden rule: **when in doubt, leave it out.**

This same filter will also be applied to LLM-extracted items as a second layer of defense.

---

## Detailed Root Cause Analysis

### Current deterministic parser flow

```
extract_todo_section_items(notes)
    |
    |-- Scan lines for markdown headings (###)
    |-- When heading matches "to do", "todos", "action item", etc.
    |       → enter "todo section" mode
    |-- For each non-heading line in the section:
    |       → normalize_todo_line()  [strips bullets, checkboxes, numbering]
    |       → push to items list  ← NO FILTERING HERE
    |-- When another heading of same/higher level appears:
    |       → exit "todo section" mode
    |
    |-- Return all collected items
```

**The critical gap**: Between `normalize_todo_line()` and `items.push()`, there is no check whether the normalized text is actually an action item. Every non-empty line under a "### to dos" heading is accepted.

### What was extracted (confirmed from database)

| # | Text | Should be a to-do? | Why/why not |
|---|------|---------------------|-------------|
| 1 | research how many rings the boston celtics had | YES | Starts with "research" (action verb, imperative mood) |
| 2 | find out erling haaland's record in the world cup | YES | Starts with "find out" (action phrase) |
| 3 | bill russelll player center in the celtics | NO | Statement -- no action verb, declarative noun phrase |
| 4 | why isn't neymar that good anymore | NO | Question -- starts with "why", no action |
| 5 | figure out why all norway soccer players are so tall | YES | Starts with "figure out" (action phrase) |
| 6 | this is NOT a to do, please don't put it in the "to do" section | NO | Meta-commentary about to-dos, not an action item |

### Why the LLM didn't run (and that's correct)

The deterministic parser found 6 items from the notes' `### to dos` section, so the code correctly skipped the LLM transcript extraction. The bug is purely in the deterministic parser's lack of filtering -- not in the LLM path.

### What makes a real to-do

A real to-do is phrased as an **imperative command** -- a verb telling you to do something:

- **Imperative mood**: "research X", "email Y", "schedule Z", "buy W"
- **Action-oriented**: describes a future action, not a current state, fact, or question
- **Self-contained**: you can read it and know what to do without additional context

What is NOT a to-do:
- **Questions**: "why is X happening?", "how does Y work?" -- these are things you wonder about, not actions to take (even if researching the answer might be a to-do, the question itself is not)
- **Statements/Facts**: "bill russell played center" -- this is a declarative statement
- **Meta-commentary**: "this is NOT a to do" -- self-referential commentary about the to-do list
- **Noun phrases**: "mom's birthday gift" -- not an action (should be "buy mom's birthday gift")

---

## Implementation Plan

### Step 1: Add `is_action_item()` filter function

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`

Add a new function that checks whether a line of text looks like a real action item:

```rust
/// Check whether a normalized to-do line is actually an action item.
/// 
/// A real to-do starts with an action verb in imperative mood
/// (e.g., "research", "find out", "email", "call", "schedule").
/// Questions, statements, and meta-commentary are rejected.
/// 
/// Golden rule: when in doubt, leave it out.
fn is_action_item(text: &str) -> bool {
    let text_lower = text.to_lowercase().trim();
    
    if text_lower.is_empty() {
        return false;
    }
    
    // --- REJECT: Meta-commentary about to-dos ---
    const META_PHRASES: &[&str] = &[
        "not a to do", "not a todo", "not an action item",
        "not a to-do", "don't put", "do not put",
        "please don't", "please do not",
        "this is not", "this isn't",
        "ignore this", "skip this",
    ];
    for phrase in META_PHRASES {
        if text_lower.contains(phrase) {
            return false;
        }
    }
    
    // --- REJECT: Questions ---
    // Lines ending with "?" are questions, not action items.
    if text_lower.ends_with('?') {
        return false;
    }
    // Lines starting with question words are questions.
    const QUESTION_STARTERS: &[&str] = &[
        "why", "how", "what", "when", "where", "who", "which", "whose",
        "is ", "are ", "was ", "were ", "do ", "does ", "did ",
        "can ", "could ", "should ", "would ", "will ", "won't ",
        "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't",
        "didnt", "can't", "cannot", "couldn't", "shouldn't", "wouldn't",
        "what's", "whats", "where's", "wheres", "who's", "whos",
    ];
    for starter in QUESTION_STARTERS {
        if text_lower.starts_with(starter) {
            return false;
        }
    }
    
    // --- ACCEPT: Lines starting with known action verbs/phrases ---
    // These are imperative-mood action words that indicate a to-do.
    const ACTION_VERBS: &[&str] = &[
        // Research / learning
        "research", "find out", "figure out", "look into", "investigate",
        "learn", "study", "explore", "read", "watch", "listen",
        // Communication
        "email", "call", "text", "contact", "reach out", "message",
        "notify", "tell", "ask", "remind", "follow up", "reply",
        "respond", "send", "share", "forward", "distribute", "post",
        // Scheduling / planning
        "schedule", "book", "set up", "arrange", "plan", "organize",
        "prepare", "draft", "write", "create", "make", "build",
        "design", "develop", "outline", "brainstorm", "sketch",
        // Review / verification
        "review", "check", "verify", "confirm", "test", "audit",
        "inspect", "examine", "analyze", "evaluate", "assess",
        "compare", "measure", "calculate", "compute",
        // Task completion
        "complete", "finish", "submit", "deliver", "update",
        "fix", "repair", "resolve", "address", "solve",
        "clean", "wash", "pack", "move", "install", "configure",
        "deploy", "refactor", "rename", "delete", "remove", "add",
        "implement", "integrate", "migrate", "backup", "restore",
        "export", "import", "convert", "format", "edit", "proofread",
        "translate", "transcribe", "summarize", "compile", "gather",
        "collect", "sort", "organize", "fill", "print", "scan",
        "copy", "download", "upload",
        // Acquisition
        "get", "buy", "order", "purchase", "obtain", "acquire",
        // Reminders / intention
        "remember to", "don't forget to", "make sure to",
        "need to", "have to", "got to",
        // Scheduling
        "cancel", "postpone", "reschedule", "register", "sign up",
        "enroll", "apply", "request", "subscribe", "unsubscribe",
        "join", "leave", "start", "stop", "pause", "resume",
        "begin", "end", "close", "open", "save", "load", "find",
        "search", "replace", "connect", "disconnect", "attach",
        "detach", "mount", "unmount", "lock", "unlock",
        // Practice / training
        "practice", "train", "exercise", "rehearse",
        // Misc actions
        "announce", "publish", "launch", "announce", "renew",
        "refund", "return", "exchange", "replace", "upgrade",
        "downgrade", "uninstall", "pair", "unpair", "link", "unlink",
    ];
    for verb in ACTION_VERBS {
        if text_lower.starts_with(verb) {
            return true;
        }
    }
    
    // --- DEFAULT: Reject ---
    // If the line doesn't start with a known action verb and doesn't
    // match any rejection pattern, default to rejecting it.
    // "When in doubt, leave it out."
    false
}
```

### Step 2: Apply `is_action_item()` in the deterministic parser

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`
**Function:** `extract_todo_section_items()`

Change the inner loop to filter each line through `is_action_item()`:

```rust
if let Some(text) = Self::normalize_todo_line(trimmed) {
    if Self::is_action_item(&text) {
        items.push(ExtractedTodoItem {
            text,
            owner: None,
            deadline: None,
        });
    } else {
        info!(
            "Rejected non-action-item line from todo section: {:?}",
            text
        );
    }
}
```

This logs every rejected line so we can debug false negatives in testing.

### Step 3: Apply `is_action_item()` to LLM-extracted items too

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`
**Function:** `extract_todos_from_sources()`

After the LLM returns items and they pass through `filter_llm_items()`, also filter through `is_action_item()`:

```rust
let transcript_items = Self::parse_extraction_response(&raw_response)?;
let pre_filter_count = transcript_items.len();
let corporate_filtered = Self::filter_llm_items(transcript_items);
let action_filtered: Vec<_> = corporate_filtered
    .into_iter()
    .filter(|item| Self::is_action_item(&item.text))
    .collect();
info!(
    "LLM transcript todo extraction: {} raw → {} after corporate filter → {} after action-item filter for meeting: {}",
    pre_filter_count,
    /* corporate_filtered count */,
    action_filtered.len(),
    meeting_id
);
action_filtered
```

This provides a second layer of defense: even if the LLM extracts something that passes the corporate filter but isn't a real action item, the action-item check will reject it.

### Step 4: Log accepted/rejected items for debugging

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`
**Function:** `extract_todo_section_items()`

Add a summary log at the end of the function:

```rust
info!(
    "Todo section parsing: {} lines found, {} accepted as action items, {} rejected",
    total_lines,
    items.len(),
    total_lines - items.len()
);
```

This makes it easy to see in the logs how many lines were scanned vs. accepted vs. rejected.

---

## Expected Results

With the fix applied, the user's notes:

```
### to dos

* research how many rings the boston celtics had          → ACCEPTED (starts with "research")
* find out erling haaland's record in the world cup        → ACCEPTED (starts with "find out")
* bill russelll player center in the celtics               → REJECTED (no action verb)
* why isn't neymar that good anymore                        → REJECTED (starts with "why")
* figure out why all norway soccer players are so tall     → ACCEPTED (starts with "figure out")
* this is NOT a to do, please don't put it in the "to do"  → REJECTED (meta-commentary: "not a to do")
```

**3 accepted, 3 rejected.** Only the real to-dos are saved.

---

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src-tauri/src/summary/todo_extractor.rs` | Add `is_action_item()` function (Step 1), apply in deterministic parser (Step 2), apply in LLM path (Step 3), add logging (Step 4) |

## Testing Checklist

1. **Statement rejection**: Write a to-do section containing "bill russell player center" → verify it's NOT extracted.
2. **Question rejection**: Write "why is the sky blue?" → verify NOT extracted.
3. **Meta-commentary rejection**: Write "this is NOT a to do" → verify NOT extracted.
4. **Real to-do acceptance**: Write "research X", "find out Y", "figure out Z" → verify all 3 ARE extracted.
5. **Mixed section**: Write a section with 3 real to-dos and 3 non-to-dos → verify only the 3 real ones are extracted.
6. **LLM path**: Run AI cleanup on a meeting with no notes → verify LLM-extracted items are also filtered through `is_action_item()`.
7. **Regeneration**: Run AI cleanup twice → verify no duplicates.
8. **TodosPage display**: Verify extracted to-dos still display correctly on the TodosPage (the BlockNote markdown loading fix from the previous session should still work).
