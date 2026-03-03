# Debug Steps for "Load failed" Error

## Step 1: Open Browser DevTools

**In the Meetily app:**
- Press **Cmd + Shift + I** (or Cmd + Option + I)
- Or click the console toggle button if visible in the UI

## Step 2: Check Console Tab

Look for the full error message. It should show something like:

```
TypeError: Load failed
  at <module/file path>
  at <stack trace>
```

## Step 3: Find the Failing Module

The error message should indicate:
- **Which file/module failed to load**
- **Why it failed** (network error, syntax error, import error, etc.)
- **Stack trace** showing where the error originated

## Step 4: Copy Full Error

Please copy and paste:
1. The complete error message
2. The stack trace
3. Any related warnings or errors above/below it

## Common Causes

This "Load failed" error typically means:
- **Import error**: A module can't be imported (syntax error, missing export)
- **Network error**: Failed to fetch a chunk/module
- **Circular dependency**: Two modules importing each other
- **Dynamic import failure**: Lazy-loaded component failed

## Quick Check

Also check the **Network tab** in DevTools:
- Look for any failed requests (red entries)
- Note which files failed to load (status 404, 500, etc.)
