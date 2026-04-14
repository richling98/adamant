---
name: review
description: Perform comprehensive code review for a Linear issue
---

# Code Review Task

Perform comprehensive code review. Be thorough but concise.

## Required Input

You MUST have a Linear issue ID (e.g., VOLI-21) to perform a code review. If not provided, ask the user for the issue ID before proceeding.

## Output Requirement

**CRITICAL:** You MUST save the code review to a markdown file at:
```
docs/issues/{ISSUE_ID}/code-review.md
```

For example, if reviewing VOLI-21, save the review to:
```
docs/issues/VOLI-21/code-review.md
```

This file should be saved alongside the `implementation-plan.md` file for that issue.

## Check For:

**Logging** - No console.log statements, uses proper logger with context
**Error Handling** - Try-catch for async, centralized handlers, helpful messages
**TypeScript** - No `any` types, proper interfaces, no @ts-ignore
**Production Readiness** - No debug statements, no TODOs, no hardcoded secrets
**React/Hooks** - Effects have cleanup, dependencies complete, no infinite loops
**Performance** - No unnecessary re-renders, expensive calcs memoized
**Security** - Auth checked, inputs validated, RLS policies in place
**Architecture** - Follows existing patterns, code in correct directory
**Translations** - Localized strings are accurate and complete for all languages

## Output Format (for code-review.md)

```markdown
# Code Review: {ISSUE_ID}

**Date:** {YYYY-MM-DD}
**Reviewer:** Codex
**Files Reviewed:** {list of files}

## Summary

{Brief summary of the changes being reviewed}

## Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Logging | ✅/⚠️/❌ | {notes} |
| Error Handling | ✅/⚠️/❌ | {notes} |
| TypeScript | ✅/⚠️/❌ | {notes} |
| Production Ready | ✅/⚠️/❌ | {notes} |
| React/Hooks | ✅/⚠️/❌ | {notes} |
| Performance | ✅/⚠️/❌ | {notes} |
| Security | ✅/⚠️/❌ | {notes} |
| Architecture | ✅/⚠️/❌ | {notes} |
| Translations | ✅/⚠️/❌ | {notes} |

## ✅ Looks Good

- {Item 1}
- {Item 2}

## ⚠️ Issues Found

- **{Severity}** `{file}:{line}` - {Issue description}
  - **Fix:** {Suggested fix}

## 📊 Final Summary

- **Files reviewed:** {X}
- **Critical issues:** {X}
- **Warnings:** {X}
- **Ready for merge:** Yes/No

## Severity Levels

- **CRITICAL** - Security, data loss, crashes
- **HIGH** - Bugs, performance issues, bad UX
- **MEDIUM** - Code quality, maintainability
- **LOW** - Style, minor improvements
```

## Workflow

1. Identify the Linear issue ID
2. Review all staged/changed files related to the issue
3. Run through all checklist items
4. Create the code-review.md file in `docs/issues/{ISSUE_ID}/`
5. Report findings to the user
