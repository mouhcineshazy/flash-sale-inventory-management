---
name: session-doc
description: >
  Document what was built and learned in the current session as a persistent
  architecture doc. Creates a new file in docs/architecture/ following the
  same format as session-01 and session-02 docs. Run at the end of each
  mentoring session. Pass the session number as an argument:
  /session-doc 03
---

# Session Documentation Tool

You are helping document a completed mentoring session on the flash-sale NestJS project.

Read `CLAUDE.md` for project context. Look at `docs/architecture/session-01-domain-modeling-and-architecture.md` and `docs/architecture/session-02-scaffold-and-concurrency-qa.md` as format references.

## What to Document

Create a file at `docs/architecture/session-$ARGUMENTS-<short-slug>.md` capturing:

1. **What Was Built** — concrete list of files created or modified, with one-line descriptions
2. **Key Decisions Made** — any architecture or design decisions reached this session, with the reasoning
3. **Q&A / Interview Prep** — questions that came up, the user's initial answer, and the correct/full answer with the key insight
4. **Current Working State** — what is verified to work (tests passing, app boots, endpoints available)
5. **What Comes Next** — specific goals for the next session, ordered by priority

## Format Rules

- Match the style of the existing session docs (use the same heading levels and structure)
- For Q&A sections: always include "Student answer" + "Correct answer" + the key insight the student should internalize
- Be precise about file paths — include the full `src/...` path for every file mentioned
- Keep "What Comes Next" as a numbered list, ordered by priority for the next session
- Do not write implementation code in the doc — write decisions, patterns, and concepts

## Before Writing

1. Ask the user: "What files did you create or modify this session?" (if not clear from context)
2. Ask: "What was the hardest concept from this session?"
3. Ask: "What interview questions came up?"

Then write the doc and confirm the file path with the user.
