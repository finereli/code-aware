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
scripts/scan.sh
```

This runs a quick scan of the last 50 commits (typically under 2 minutes). It extracts architectural observations, discovers natural model boundaries, and generates narrative developer notes.

### After the scan completes

Do these three things in order:

1. **Show the insights.** Read `.code-aware/INSIGHTS.md` and present its contents to the developer. This is the most compelling output — it shows what code-aware understood about the codebase.

2. **Recommend a full scan.** Tell the developer: "The quick scan covered the last 50 commits. For deeper architectural coverage, you can run a full scan in a separate terminal — it doesn't interfere with your current work:"
   ```
   scripts/scan.sh . --full
   ```

3. **Ask about CLAUDE.md integration.** Ask the developer whether they'd like to add code-aware instructions to their project's memory file (`CLAUDE.md`, `AGENTS.md`, or whichever exists). If they agree, add instructions like:
   ```
   ## Code Awareness

   This project uses code-aware for architectural memory. Before making, planning, proposing, or discussing any code changes:
   1. Read `.code-aware/index.md` to see available models
   2. Read the relevant model files in `.code-aware/models/` for the components you'll touch

   After committing changes, run `scripts/sync.sh` to keep models current.
   ```

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
scripts/sync.sh
```

This processes only new commits since the last scan.

## The feedback loop

The more context you have about the codebase, the better your commit messages become. Better commit messages feed richer information back into the models. The system improves its own input quality over time.

## What the models contain

Each model file contains developer notes organized by topic:
- **How things work** — specific file names, function names, data flows
- **Why they were built that way** — design rationale, constraints, alternatives considered
- **What must remain true** — invariants and assumptions the system depends on
- **Known issues** — gotchas, fragile areas, failed approaches

## Configuration

Auto-detects LLM provider from `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the environment.

- `CODE_AWARE_MODEL` — override the LLM model for observation extraction and synthesis
- `CODE_AWARE_INSIGHTS_MODEL` — override the model for codebase insights
