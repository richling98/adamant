# How to Start the Adamant App

**Last Updated:** 2026-05-04

This guide launches the Adamant desktop application in development mode.

---

## Prerequisites

Before starting, ensure you have:

- Rust and Cargo installed (`~/.cargo/bin/cargo`)
- Node.js and pnpm installed
- Frontend dependencies installed (`pnpm install` from `frontend/` if needed)

---

## Quick Start

### macOS Recommended Path

```bash
cd /Users/rling/Documents/Projects/adamant/frontend
./clean_run.sh
```

What this does:

1. Cleans previous frontend/Tauri development artifacts.
2. Installs dependencies if needed.
3. Builds the Next.js frontend.
4. Builds the debug Tauri app.
5. Signs the development app as `Adamant Dev`.
6. Launches the signed `.app` bundle.

Use this path for recording tests. macOS microphone permissions are attached to the launched app identity, so launching `Adamant Dev.app` avoids the common problem where permissions were granted to one binary but the dev app runs as another.

Expected wait time: 1-2 minutes for a clean first run, less after dependencies and Rust artifacts are warm.

### Debug Logging

```bash
cd /Users/rling/Documents/Projects/adamant/frontend
./clean_run.sh debug
```

---

## Manual Launch

Use this when you specifically need the lower-level Tauri development command:

```bash
cd /Users/rling/Documents/Projects/adamant/frontend
source ~/.cargo/env
pnpm run tauri:dev
```

On macOS, prefer `./clean_run.sh` for interactive microphone tests because it launches the signed development app bundle.

---

## Verification Checklist

After launching, verify:

- The Adamant window appears.
- The sidebar and meeting details page render.
- No blocking errors appear in the terminal.
- DevTools (`Cmd+Shift+I`) has no repeated red errors.
- Recording tests can access the microphone after `Adamant Dev` is granted permission.

---

## Troubleshooting

### Port 3118 already in use

```bash
lsof -ti:3118 | xargs kill -9
./clean_run.sh
```

### `cargo: command not found`

```bash
source ~/.cargo/env
which cargo
./clean_run.sh
```

`which cargo` should print `/Users/rling/.cargo/bin/cargo`.

### Microphone permission denied on macOS

1. Quit Adamant.
2. Open System Settings > Privacy & Security > Microphone.
3. Enable microphone access for `Adamant Dev`.
4. Relaunch with:

   ```bash
   cd /Users/rling/Documents/Projects/adamant/frontend
   ./clean_run.sh
   ```

If `Adamant Dev` is not listed, launch once with `./clean_run.sh`, trigger a recording, then reopen the Microphone permissions pane.

### App window does not appear

```bash
ps aux | grep -i adamant | grep -v grep
pkill -9 adamant
pkill -9 -f "Adamant Dev"
./clean_run.sh
```

### Rust compilation errors

```bash
cd /Users/rling/Documents/Projects/adamant/frontend
./clean_run.sh
```

If errors persist, read the first Rust error in the terminal output; later errors are often cascading.

### `pnpm: command not found`

```bash
npm install -g pnpm
pnpm --version
./clean_run.sh
```

---

## Stopping the App

- Press `Cmd+Q` while Adamant is focused.
- Or press `Ctrl+C` in the terminal running the app.
- If it is frozen:

  ```bash
  pkill -9 adamant
  pkill -9 -f "Adamant Dev"
  pkill -9 -f "tauri dev"
  pkill -9 -f "next dev.*3118"
  ```

---

## Advanced Commands

```bash
# Next.js frontend only
pnpm run dev

# Manual Tauri dev mode
pnpm run tauri:dev

# CPU-only transcription build
pnpm run tauri:dev:cpu

# CUDA build
pnpm run tauri:dev:cuda

# Vulkan build
pnpm run tauri:dev:vulkan

# Metal/CoreML build
pnpm run tauri:dev:metal

# Production build
./clean_build.sh
```

The production app bundle is written under `frontend/src-tauri/target/release/bundle/`.

---

## Quick Reference

```bash
cd /Users/rling/Documents/Projects/adamant/frontend
source ~/.cargo/env
./clean_run.sh
```

For the current note-persistence flow, a useful smoke test is:

1. Start a meeting recording.
2. Type in `My Notes`.
3. End the recording.
4. Generate AI Cleanup.
5. Navigate to another meeting note.
6. Navigate back.
7. Confirm the typed `My Notes` content is still present.
