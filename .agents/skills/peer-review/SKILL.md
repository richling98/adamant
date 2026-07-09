---
name: "peer-review"
description: "Critically evaluate and append peer review to code-review.md"
---

# Peer Review Analysis

A different team lead within the company has reviewed the current code/implementation and provided findings below. Important context:

- **They have less context than you** on this project's history and decisions
- **You are the team lead** - don't accept findings at face value
- Your job is to critically evaluate each finding

## Required Input

You MUST have a Linear issue ID (e.g., VOLI-21) to perform a peer review. If not provided, ask the user for the issue ID before proceeding.

## Output Requirement

**CRITICAL:** You MUST append the peer review to the EXISTING code-review.md file at:
```
docs/issues/{ISSUE_ID}/code-review.md
```

Do NOT create a separate file. The peer review should be added as a new section at the end of the existing code review, separated by a horizontal rule (`---`).

## Workflow

1. Read the existing `docs/issues/{ISSUE_ID}/code-review.md` file
2. Analyze the peer review findings
3. Append your analysis to the END of the same file

## Analysis Process

For EACH finding in the peer review:

1. **Verify it exists** - Actually check the code. Does this issue/bug really exist?
2. **If it doesn't exist** - Explain clearly why (maybe it's already handled, or they misunderstood the architecture)
3. **If it does exist** - Assess severity and add to your fix plan

## Output Format (append to code-review.md)

```markdown
---

## Peer Review of This Code Review (Meta-Review)

**Reviewer:** {Your Name/Model}
**Date:** {YYYY-MM-DD}

### Validation Against Source

- **{Finding 1}:** {Confirmed/Rejected} - {explanation} ✓/✗
- **{Finding 2}:** {Confirmed/Rejected} - {explanation} ✓/✗

### Gaps / Corrections

1. **{SEVERITY}** **{Issue title}**
   {Description of the issue}
   - **Fix:** {Suggested fix or action}

2. **{SEVERITY}** **{Issue title}**
   {Description of the issue}
   - **Fix:** {Suggested fix or action}

### Summary

- **Code review structure:** {Assessment} ✓/✗
- **Checklist:** {Assessment} ✓/✗
- **Critical issues in review:** {count}
- **Corrections to original review:** {count with severity breakdown}
- **Verdict:** {Final assessment and recommendation}
```

## After Analysis

Provide to the user:
- Summary of valid findings (confirmed issues)
- Summary of invalid findings (with explanations)
- Prioritized action plan for confirmed issues
- Note that the peer review has been appended to the code-review.md file
