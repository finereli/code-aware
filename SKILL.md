# code-aware

Give your coding agent architectural memory. code-aware processes git history to build a mental model of your codebase — not just what exists, but why it was built that way and how it evolved.

## Setup

If `.code-aware/` doesn't exist in the repo root, run the initial scan:

```bash
OPENAI_API_KEY=$OPENAI_API_KEY npx tsx /path/to/code-aware/src/index.ts scan --repo .
```

This takes a few minutes depending on repo size. It reads git history, extracts architectural observations, and synthesizes them into model files.

## Usage

### Before starting work

Check if models are current:

```bash
npx tsx /path/to/code-aware/src/index.ts status --repo .
```

If stale, update:

```bash
OPENAI_API_KEY=$OPENAI_API_KEY npx tsx /path/to/code-aware/src/index.ts sync --repo .
```

### Reading the models

The `.code-aware/` directory contains:
- `index.md` — list of all models with descriptions
- `models/` — one markdown file per architectural component

Read `index.md` first to see what models exist, then read specific model files for the components relevant to your current task.

### When to read models

- **Before modifying a component** — read its model to understand design intent, invariants, and gotchas
- **When making architectural decisions** — read the architecture model for system-wide patterns
- **When something breaks unexpectedly** — the model may document known fragile areas or past failures

### After making changes

After committing changes, run `sync` to update the models. This processes only new commits. Over time, the models capture the full evolution of the codebase, and your commit messages become the primary source of architectural memory.

## What the models contain

Each model file contains developer notes organized by topic:
- **How things work** — specific file names, function names, data flows
- **Why they were built that way** — design rationale, constraints, alternatives considered
- **What must remain true** — invariants and assumptions the system depends on
- **Known issues** — gotchas, fragile areas, failed approaches

## The feedback loop

code-aware creates a virtuous cycle: the more context your agent has about the codebase, the better its commit messages become. Better commit messages feed richer information back into the models. The system improves its own input quality over time.

## Configuration

- `OPENAI_API_KEY` — required, uses gpt-4.1-mini by default
- `CODE_AWARE_MODEL` — optional, override the LLM model name
