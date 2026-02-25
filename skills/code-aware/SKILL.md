---
name: code-aware
description: Gives you architectural memory of the codebase. Reads git history and builds developer-notes-style models of each component — what exists, why it was built that way, known gotchas, and invariants. Use before modifying code, when making architectural decisions, or when something breaks unexpectedly.
allowed-tools: Bash Read Glob Grep
metadata:
  author: finereli
  version: "0.2.0"
---

# code-aware

Architectural memory for your codebase, built from git history.

## First-time setup

If `.code-aware/` doesn't exist in the repo root, run the initial scan:

```bash
OPENAI_API_KEY=$OPENAI_API_KEY scripts/scan.sh
```

This takes 2-5 minutes depending on repo size. It reads the full git history, extracts architectural observations, discovers natural model boundaries, and synthesizes them into narrative developer notes.

## Reading the models

The `.code-aware/` directory contains:
- `index.md` — list of all models with descriptions
- `models/*.md` — one file per architectural component
- `INSIGHTS.md` — six opinionated observations about the codebase

**Read `index.md` first** to see what models exist, then read the specific model files relevant to your current task.

### When to read models

- **Before modifying a component** — read its model to understand design intent, invariants, and gotchas
- **When making architectural decisions** — read related models for system-wide patterns
- **When something breaks unexpectedly** — models document known fragile areas and past failures

## Keeping models current

After committing changes, check staleness and update:

```bash
scripts/status.sh
```

If stale:

```bash
OPENAI_API_KEY=$OPENAI_API_KEY scripts/sync.sh
```

This processes only new commits since the last scan. Over time, the models capture the full evolution of the codebase.

## The feedback loop

The more context you have about the codebase, the better your commit messages become. Better commit messages feed richer information back into the models. The system improves its own input quality over time.

## What the models contain

Each model file contains developer notes organized by topic:
- **How things work** — specific file names, function names, data flows
- **Why they were built that way** — design rationale, constraints, alternatives considered
- **What must remain true** — invariants and assumptions the system depends on
- **Known issues** — gotchas, fragile areas, failed approaches

## Configuration

- `OPENAI_API_KEY` — required, uses gpt-4.1-mini by default
- `CODE_AWARE_MODEL` — override the LLM model for observation extraction and synthesis
- `CODE_AWARE_INSIGHTS_MODEL` — override the model for codebase insights (defaults to gpt-4.1)
