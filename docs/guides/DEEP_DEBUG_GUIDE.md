# Deep Debugging Guide - Note Persistence Bug

## Status: Root Cause Analysis Mode

I've added **comprehensive debug logging** to trace exactly what's happening. Before implementing any more fixes, we need to understand the precise sequence of events.

---

## 🔍 What I Added

### New Debug Logs to Watch For:

1. **Component Lifecycle:**
   - `🎬 COMPONENT MOUNTED` - When NotesPanel mounts
   - `💀 COMPONENT UNMOUNTING` - When it unmounts
   - `🔍 DEBUG NotesPanel RENDER #X` - Each render with count

2. **Editor Initialization:**
   - `📝 INITIAL CONTENT computed` - What initialContent is being calculated
   - `🎨 EDITOR state` - Current editor state

3. **Content Changes:**
   - `📝 EDITOR CHANGE` - When editor content changes
   - `💾 Setting noteContent state` - When React state is updated

4. **Save Flow:**
   - Existing logs for save process

---

## 🧪 Test Instructions

### Step 1: Restart the App

```bash
cd /Users/rling/Personal\ projects/meeting-minutes/frontend
source ~/.cargo/env
pnpm run tauri:dev
```

### Step 2: Open DevTools

Press **Cmd + Shift + I** to open the console.

### Step 3: Clear Console

Click the clear button (🚫) to start fresh.

### Step 4: Reproduce the Bug - SLOWLY

1. Click the pencil icon (✏️)
2. **Wait 1 second**
3. Type **ONE WORD:** "testing"
4. **STOP - Don't type anything else**
5. **Watch the console closely**
6. Wait for auto-save (2 seconds)
7. **Observe what happens**

---

## 📊 Critical Information Needed

### Question 1: Component Lifecycle

In the console logs, look for:
- `🎬 COMPONENT MOUNTED`
- `💀 COMPONENT UNMOUNTING`

**Answer these:**
- [ ] How many times does the component MOUNT during the bug? here are the console logs related to "MOUNT": "[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: false} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎬 COMPONENT MOUNTED (11940_next_dist_71b62aee._.js, line 2298)
[Log] ✅ Component mounted on client (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 💀 COMPONENT UNMOUNTING (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: false} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎬 COMPONENT MOUNTED (11940_next_dist_71b62aee._.js, line 2298)
[Log] ✅ Component mounted on client (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)

- [ ] Does it UNMOUNT and then REMOUNT when content disappears? yes it looks like it unmounted first, and then remounted. here are the console logs related to that : "[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: false} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎬 COMPONENT MOUNTED (11940_next_dist_71b62aee._.js, line 2298)
[Log] ✅ Component mounted on client (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 2, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 💀 COMPONENT UNMOUNTING (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: false} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎬 COMPONENT MOUNTED (11940_next_dist_71b62aee._.js, line 2298)
[Log] ✅ Component mounted on client (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)"

- [ ] Or does it stay mounted (no unmount message)? it definitely does unmount, per the console logs above. 

### Question 2: Initial Content

Look for logs that say `📝 INITIAL CONTENT computed`

**Tell me:**
- What does it show BEFORE you type? 
- What does it show AFTER the save completes?
- Specifically look at:
  - `isNewNote: true/false`
  - `hasNoteContent: true/false`
  - `noteContentBlocksCount: X`
  here are the console logs before i type anything: "[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "empty paragraph"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "new", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "empty paragraph"}Object"

and here are the full console logs after i type something: "[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "new", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "empty paragraph"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "new", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "new", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "new", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "new", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: true, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "empty paragraph"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "meeting-ca134c52-cebe-44ed-bd36-9f1b798618a3", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: false, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: false, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "undefined"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "meeting-ca134c52-cebe-44ed-bd36-9f1b798618a3", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: false, hasNoteContent: false, noteContentBlocksCount: 0, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: false, hasNoteContent: false, noteContentBlocksCount: 0, initialContentType: "undefined"}Object
[Log] 📄 PAGE CONTENT: Initializing with data: – {meetingId: "meeting-ca134c52-cebe-44ed-bd36-9f1b798618a3", summaryDataKeys: null, transcriptsCount: 0} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 INITIAL CONTENT computed: – {isNewNote: false, hasNoteContent: true, noteContentBlocksCount: 2, …} (11940_next_dist_71b62aee._.js, line 2298)
{isNewNote: false, hasNoteContent: true, noteContentBlocksCount: 2, initialContentType: "from noteContent"}Object"

### Question 3: Editor State

Look for `🎨 EDITOR state` logs

**Tell me:**
- What is `editorDocumentLength` BEFORE save? here are the console logs before i type/save anything: "[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: false} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 🎨 EDITOR state: – {editorExists: true, editorDocumentLength: 1, isMounted: true} (11940_next_dist_71b62aee._.js, line 2298)"

- What is `editorDocumentLength` AFTER save (when content disappears)? the length goes to 2 when i type, but after it saves, it goes back to 1. 

### Question 4: Content Changes

Look for `📝 EDITOR CHANGE` logs

**Answer:**
- Do you see these when you type "testing"? yes, here are the console logs when i type "testing": "[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "t", timestamp: "15:51:22.283Z"} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "te", timestamp: "15:51:22.378Z"} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "tes", timestamp: "15:51:22.443Z"} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "test", timestamp: "15:51:22.494Z"} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "testi", timestamp: "15:51:22.680Z"} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "testin", timestamp: "15:51:22.714Z"} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "testing", timestamp: "15:51:22.798Z"} (11940_next_dist_71b62aee._.js, line 2298)
[Log] 📝 EDITOR CHANGE: – {blocksCount: 2, firstBlockPreview: "Testing", timestamp: "15:51:24.457Z"} (11940_next_dist_71b62aee._.js, line 2298)"

- Do you see any AFTER the save completes? no, no new "editor change" logs appear after the save happens. 

- If yes, what is the `firstBlockPreview`? (Is it empty or does it have content?)

### Question 5: Visual Observation

**When the content disappears, what do you see?**
- [ ] The entire note area flashes/reloads -- yes, the entire note just flushes and reloads. 
- [ ] Just the text disappears (UI stays the same)
- [ ] You see a loading spinner
- [ ] Something else: ________________

### Question 6: Timing

**EXACTLY when does content disappear?**
- [ ] The INSTANT "Saved" appears -- yes 
- [ ] 0.5 seconds AFTER "Saved" appears
- [ ] 1+ seconds AFTER "Saved" appears

---

## 📋 What to Send Me

After reproducing the bug, copy and paste:

1. **ALL console logs** from when you opened the note until content disappeared
2. **Answers to the 6 questions above**
3. **Optional but helpful:** A short screen recording (even iPhone video of screen is fine)

---

## 🎯 What I'm Looking For

This will tell me:

1. **Is the component remounting?**
   - If yes: Something is causing React to destroy/recreate the component
   - If no: The editor content is being reset while component stays alive

2. **What initialContent is being used?**
   - Is it using the wrong initial content on re-render?
   - Is noteContent state being lost?

3. **Is the editor being recreated?**
   - useCreateBlockNote might be creating a new editor instance

4. **When does the editor change?**
   - Is something calling the editor to update AFTER save?
   - Is the onChange firing unexpectedly?

---

## 🚫 Do NOT Fix Yet

I will NOT implement any more fixes until we have this data. Previous fixes failed because I didn't fully understand the root cause.

**Let's get the data first, then fix it RIGHT.**
