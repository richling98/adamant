# How to Start the Adamant App

**Last Updated:** 2026-02-07

This guide provides step-by-step instructions to launch the Adamant desktop application in development mode.

---

## Prerequisites

Before starting, ensure you have:
- ✅ Rust and Cargo installed (`~/.cargo/bin/cargo`)
- ✅ Node.js and pnpm installed
- ✅ All dependencies installed (run `pnpm install` if needed)

---

## Quick Start (Recommended)

### Option 1: Using the Clean Run Script

**On macOS:**

```bash
cd /Users/rling/Personal\ projects/meeting-minutes/frontend
./clean_run.sh
```

**What this does:**
1. Cleans previous builds
2. Installs dependencies
3. Builds Next.js
4. Launches Tauri app with CoreML (Metal GPU) features

**Expected wait time:** 1-2 minutes for first run

---

### Option 2: Manual Launch (More Control)

**Step 1: Open Terminal**

**Step 2: Navigate to frontend directory**
```bash
cd /Users/rling/Personal\ projects/meeting-minutes/frontend
```

**Step 3: Load Rust environment**
```bash
source ~/.cargo/env
```

**Step 4: Start the app**
```bash
pnpm run tauri:dev
```

**Expected output:**
```
🍎 Apple Silicon detected - using Metal + CoreML
🚀 Running: tauri dev with features: coreml
     Running BeforeDevCommand (`pnpm dev`)
     Running DevCommand (`cargo run --features coreml...`)
...
     Finished `dev` profile [unoptimized + debuginfo] target(s) in X.XXs
     Running `/Users/rling/Personal projects/meeting-minutes/target/debug/adamant`
```

**Wait time:** 30-60 seconds for compilation and startup

---

## Step-by-Step Visual Guide

### 1. Open Terminal Application
- **Method 1:** Press `Cmd + Space`, type "Terminal", press Enter
- **Method 2:** Open from Applications → Utilities → Terminal

### 2. Navigate to Project
Copy and paste this command:
```bash
cd /Users/rling/Personal\ projects/meeting-minutes/frontend
```
Press **Enter**

### 3. Load Rust Tools
Copy and paste this command:
```bash
source ~/.cargo/env
```
Press **Enter**

You should see no output (this is normal)

### 4. Start Development Server
Copy and paste this command:
```bash
pnpm run tauri:dev
```
Press **Enter**

### 5. Wait for Startup
You'll see several stages:
1. **Installing dependencies** (if needed)
2. **Starting Next.js dev server** (port 3118)
3. **Compiling Rust code** (may show warnings - this is normal)
4. **Launching app** (desktop window appears)

**Total time:** 30-90 seconds

### 6. App Opens Successfully When You See:
- ✅ A Adamant window appears on your screen
- ✅ Terminal shows: `Running /Users/rling/.../adamant`
- ✅ No error messages in terminal

---

## Verification Checklist

After launching, verify everything is working:

### Terminal Checks
- [ ] No error messages (warnings are OK)
- [ ] You see: `Finished 'dev' profile`
- [ ] You see: `Running /Users/rling/.../adamant`

### App Checks
- [ ] Adamant window is visible on screen
- [ ] You can see the sidebar
- [ ] You can click the home icon
- [ ] No error popups appear

### Developer Console Checks (Optional)
1. In the Adamant app, press **Cmd + Shift + I**
2. Check Console tab - should see normal logs, no red errors

---

## Troubleshooting Common Issues

### Issue 1: "Port 3118 already in use"

**Error message:**
```
Error: listen EADDRINUSE: address already in use :::3118
```

**Solution:**
```bash
# Kill process using port 3118
lsof -ti:3118 | xargs kill -9

# Then restart the app
pnpm run tauri:dev
```

---

### Issue 2: "cargo: command not found"

**Error message:**
```
cargo: command not found
```

**Solution:**
```bash
# Load Rust environment first
source ~/.cargo/env

# Verify cargo is available
which cargo
# Should output: /Users/rling/.cargo/bin/cargo

# Then start app
pnpm run tauri:dev
```

---

### Issue 3: App window doesn't appear

**Symptoms:**
- Terminal shows "Running /Users/.../adamant"
- But no window appears on screen

**Solution:**
1. Check if app is running:
   ```bash
   ps aux | grep adamant | grep -v grep
   ```
2. If process exists, look for the window in Mission Control (swipe up with 3 fingers)
3. If still not visible, quit and restart:
   ```bash
   pkill -9 adamant
   pnpm run tauri:dev
   ```

---

### Issue 4: Rust compilation errors

**Symptoms:**
- Red error messages during compilation
- Process stops with "error: could not compile..."

**Solution:**
```bash
# Clean and rebuild
cd /Users/rling/Personal\ projects/meeting-minutes
cargo clean
cd frontend
pnpm run tauri:dev
```

---

### Issue 5: "pnpm: command not found"

**Solution:**
```bash
# Install pnpm if not available
npm install -g pnpm

# Then try again
pnpm run tauri:dev
```

---

## Stopping the App

### Method 1: From the App
- Click the red close button (macOS)
- Or press **Cmd + Q** while app is focused

### Method 2: From Terminal
- Press **Ctrl + C** in the terminal where app is running
- Wait a few seconds for graceful shutdown

### Method 3: Force Kill (if app is frozen)
```bash
pkill -9 adamant
pkill -9 -f "tauri dev"
pkill -9 -f "next dev.*3118"
```

---

## Advanced Options

### Start with Different GPU Features

**CPU only (no GPU):**
```bash
pnpm run tauri:dev:cpu
```

**CUDA (NVIDIA GPU):**
```bash
pnpm run tauri:dev:cuda
```

**Vulkan (AMD/Intel GPU):**
```bash
pnpm run tauri:dev:vulkan
```

**Metal (macOS default):**
```bash
pnpm run tauri:dev:metal
```

---

## Production Build

To build the production version (not for development):

```bash
cd /Users/rling/Personal\ projects/meeting-minutes/frontend
./clean_build.sh
```

The built app will be in: `src-tauri/target/release/bundle/`

---

## Checking App Status

### Is the app running?
```bash
ps aux | grep adamant | grep -v grep
```

**Expected output if running:**
```
rling  12345  0.5  0.8  440588928  196848  ??  Running...
```

### Is the dev server running?
```bash
lsof -i:3118
```

**Expected output if running:**
```
COMMAND   PID  USER   FD   TYPE ... NODE NAME
node    12346 rling  17u  IPv6 ... TCP *:pkagent (LISTEN)
```

### View app logs
```bash
# If you started with output redirection
tail -f /tmp/adamant.log

# Or check system logs (if configured)
```

---

## Getting Help

If you encounter issues not covered here:

1. **Check terminal output** for error messages
2. **Open DevTools** in the app (Cmd+Shift+I) and check Console
3. **Check GitHub issues** for similar problems
4. **Run diagnostics:**
   ```bash
   # Check versions
   cargo --version
   node --version
   pnpm --version

   # Check port availability
   lsof -i:3118

   # Check process status
   ps aux | grep -E "adamant|tauri|next" | grep -v grep
   ```

---

## Quick Reference Commands

```bash
# Navigate to project
cd /Users/rling/Personal\ projects/meeting-minutes/frontend

# Load Rust environment
source ~/.cargo/env

# Start app
pnpm run tauri:dev

# Stop app (in terminal)
Ctrl + C

# Force kill all processes
pkill -9 adamant && pkill -9 -f "tauri dev" && pkill -9 -f "next dev.*3118"

# Clean restart
./clean_run.sh

# Check if running
ps aux | grep adamant | grep -v grep
```

---

## Summary: Fastest Way to Start

**Copy and paste these commands one at a time:**

```bash
cd /Users/rling/Personal\ projects/meeting-minutes/frontend
source ~/.cargo/env
pnpm run tauri:dev
```

**Then wait 30-60 seconds for the app window to appear.**

That's it! 🎉

---

## After Starting - Test the Fix

Once the app is running, test the note persistence fix:

1. Click the **pencil icon** (✏️) to create a new note
2. Type: "Testing note persistence"
3. Wait 2-3 seconds for auto-save
4. Navigate away (click home)
5. Navigate back to the note
6. **Expected:** Your content is still there ✅

---

**Questions?** Check the troubleshooting section or review terminal output for specific error messages.
