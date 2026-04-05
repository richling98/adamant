# Feature Freeze Notice: Architecture Hardening Program

**Effective:** 2026-04-04
**Lifted:** When Steps 1-4 are complete and Gates A-E are defined in the dependency inventory.

## Frozen Work Areas

The following areas must not receive new feature work until the architecture hardening program
completes Wave 1 (Steps 1-4):

- **Settings UI** - no new API key fields, no new provider integrations
- **Secrets / API key storage** - no new columns, no new Tauri commands that read or write raw keys
- **Summary ownership** - no moving summary storage to new backends or new tables
- **Persistence layer** - no new migrations that add user data to the Python backend DB
- **Backend CORS / binding** - no relaxing of network exposure

## What Is NOT Frozen

- Bug fixes to existing recording, transcription, and playback flows
- UI polish that does not touch settings, secrets, or persistence
- Documentation, tests, and observability improvements
- Work that is explicitly part of the hardening program itself

## How to Request an Exception

If a critical bug requires touching a frozen area, document the change in a new ADR and confirm
it does not conflict with the hardening plan's end state before merging.
