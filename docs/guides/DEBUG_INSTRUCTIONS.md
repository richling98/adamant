# DEBUG INSTRUCTIONS - Critical Data Loss Bug

## Steps to Reproduce and Debug

### 1. Open Developer Console
- On macOS: Press **Cmd + Shift + I**
- Or use the console toggle button in the app UI

### 2. Clear Console
- Click the clear button (🚫) to start fresh

### 3. Reproduce the Bug
1. Click the **pencil icon** (✏️) to create a new note
2. Type some content: "TEST CONTENT 123"
3. **Wait 2-3 seconds** for auto-save to trigger
4. **Watch what happens** - does content disappear?

### 4. Copy ALL Console Logs
Please copy and paste ALL console messages that appear, especially looking for:

- `📝 NotesPanel: Content changed`
- `📝 NotesPanel: Creating new meeting for note...`
- `📝 NotesPanel: Content is blank, skipping save`
- `✅ NotesPanel: Meeting created:`
- `✅ NotesPanel: Note created successfully`
- `✅ Sidebar refreshed with new note:`
- `ℹ️ NotesPanel: No existing note found`
- Any error messages (❌)

### 5. Additional Info Needed

Please also tell me:

**A) What happens visually?**
- [ ] Content disappears immediately when "Saved" appears
- [ ] Content stays but a new blank note appears
- [ ] Editor clears out and shows empty paragraph
- [ ] Something else: _______________

**B) What does the "Saved" indicator show?**
- [ ] Shows "Saved" but content is gone
- [ ] Shows "Saving..." but never completes
- [ ] Shows error
- [ ] Doesn't show anything

**C) In the sidebar, what happens?**
- [ ] A new "Untitled Note" appears
- [ ] No new note appears
- [ ] Multiple notes appear
- [ ] Sidebar doesn't update

---

## Why This Information is Critical

The console logs will tell us:
1. Whether my blank validation is incorrectly triggering
2. Whether the save completes successfully
3. Whether there's a race condition with note loading
4. Whether the editor is reinitializing unexpectedly

Once I see the logs, I'll know exactly what's wrong and can fix it immediately.
