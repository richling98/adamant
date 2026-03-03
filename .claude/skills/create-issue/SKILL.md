---
name: create-issue
description: Quickly capture and create a Linear issue
---

# Create Issue

User is mid-development and thought of a bug/feature/improvement. Always ask the user:
- What's the issue/feature
- Current behavior vs desired behavior
- Type (bug/feature/improvement) and priority if not obvious

## Your Goal

Create a complete Linear issue with:
- Clear title
- TL;DR of what this is about
- Current state vs expected outcome
- Relevant files that need touching
- Risk/notes if applicable
- Proper type/priority/effort labels

**After gathering info, use the Linear MCP to create the issue in their workspace.**

**IMPORTANT: Always create issues in the "Todo" state (stateId: "3d8e2092-7e47-4f9d-8dfa-42c157dd3804"), NOT in Backlog.**

## How to Get There

**Ask questions** to fill gaps - don't be afraid to push back on the user if their issue is vague, as we want to get to the most detailed issue possible. For example, if the user describes their issue very vaguely or without much context, ask them followup questions!

Feel free to do as many back-and-forths as you want until you have clarity on the issue at hand.

**Search for context** only when helpful:
- Web search for best practices if it's a complex feature
- Grep codebase to find relevant files
- Note any risks or dependencies you spot

**Skip what's obvious** - If it's a straightforward bug, don't search web. If type/priority is clear from description, don't ask.

**Keep it fast** - Total exchange under 5min. Be conversational but brief. Get what you need, create ticket, done.

## Behavior Rules

- Be conversational - ask what makes sense, not a checklist
- Default priority: normal, effort: medium (ask only if unclear)
- Max 3 files in context - most relevant only
- Bullet points over paragraphs
