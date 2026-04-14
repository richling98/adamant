# ADA-8: Chat with Meeting Notes

## Summary

Add a persistent floating chat bubble to the app that lets users interactively
query their meeting transcripts with natural language. The AI powering the chat
is the same model the user already configured for summaries — no additional
setup required.

## Current State

- Users can view AI summaries generated from individual meetings
- There is no way to query _across_ multiple meetings interactively
- There is no conversational interface anywhere in the app

## Desired Outcome

1. A floating circular 😊 button is always visible in the **bottom-right corner**
   of the app, rendered on top of all content (`z-[9999]`)
2. Clicking the button opens a **right-side slide-in chat sheet** (w-96)
3. The user types a message (e.g. "summarize my past week") and receives an AI
   response that has full context of all stored meeting transcripts
4. Chat history persists for the session; closing/reopening the sheet keeps the
   conversation alive until the app restarts
5. A trash icon in the sheet header clears the history on demand
6. The feature works with every supported LLM provider: BuiltIn AI, Ollama,
   Claude, Groq, OpenRouter, CustomOpenAI — identical to the summary feature

