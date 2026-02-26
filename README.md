# code-aware

Give your coding agent architectural memory.

code-aware processes git history to build a mental model of your codebase — not just what exists, but why it was built that way and how it evolved. The output is a set of developer-notes-style markdown files that any coding agent can read before making changes.

Works with Claude Code, Codex, Copilot, Cursor, and any tool that supports the [Agent Skills](https://agentskills.io) standard.

## Install

### Claude Code (marketplace)

In Claude Code, run:

```
/plugin marketplace add finereli/code-aware
/plugin install code-aware@finereli
```

That's it. The skill is now available across all your projects.

### Claude Code (local)

For development or if you prefer a local install:

```bash
git clone https://github.com/finereli/code-aware.git ~/code-aware
cd ~/code-aware && npm install
claude --plugin-dir ~/code-aware
```

### Other agents (Codex, Copilot, Cursor)

```bash
git clone https://github.com/finereli/code-aware.git ~/code-aware
cd ~/code-aware && npm install
ln -s ~/code-aware/skills/code-aware ~/.claude/skills/code-aware
```

Your agent will discover code-aware automatically and use it when relevant.

## First Scan

Ask your agent to scan the codebase — code-aware automatically uses whatever LLM is available in your environment (Haiku on Claude Code, GPT-4.1-mini on Codex).

Or run manually:

```bash
cd /path/to/your/project
~/code-aware/skills/code-aware/scripts/scan.sh
```

The default quick scan processes the **last 50 commits** (~2 minutes). For full history:

```bash
~/code-aware/skills/code-aware/scripts/scan.sh . --full
```

Output lands in `.code-aware/`:
- `index.md` — list of all models with descriptions
- `models/*.md` — one file per architectural component
- `INSIGHTS.md` — six opinionated observations about the codebase

## What It Produces

Models are **adaptive** — no hardcoded categories. The system samples observations from your actual codebase and discovers the right boundaries. A Flutter app gets different models than a Python CLI or a Cloudflare Workers API.

Each model file reads like a senior developer's personal notes:

```markdown
# Contact Management

> CRUD operations, referral tracking, follow-up scheduling, and archiving

## Follow-up Scheduling
- Follow-ups include both `followup_date` and `followup_type` fields.
  Both must remain synchronized — partial updates caused 500 errors previously.
- UI refactored from two-step modal to single dialog...

## Important Invariants
- Entries with `removed_at` set are excluded from active listings and statistics.
- Only entries with neither timestamp set are considered "active and pending."
...
```

Real file names, real function names, actual gotchas and invariants. Not a database dump — useful context.

## The Feedback Loop

code-aware creates a virtuous cycle: the more context your agent has about the codebase, the better its commit messages become. Better commit messages feed richer information back into the models. The system improves its own input quality over time.

## Keeping Models Current

After committing new work, sync to process only new commits:

```bash
~/code-aware/skills/code-aware/scripts/sync.sh
```

Check staleness without updating:

```bash
~/code-aware/skills/code-aware/scripts/status.sh
```

Or just ask your agent — the skill knows when to check and update.

## Configuration

code-aware auto-detects your LLM provider from environment variables:

| Provider | Key | Default model | Default insights model |
|----------|-----|---------------|----------------------|
| OpenAI | `OPENAI_API_KEY` | gpt-4.1-mini | gpt-4.1 |
| Anthropic | `ANTHROPIC_API_KEY` | claude-haiku-4 | claude-sonnet-4 |

Override with:

| Variable | Description |
|----------|-------------|
| `CODE_AWARE_MODEL` | Override the model for observation extraction and synthesis |
| `CODE_AWARE_INSIGHTS_MODEL` | Override the model for codebase insights |

## How It Works

1. **Load** — reads git log with diffs
2. **Observe** — LLM extracts architectural observations from commit batches (focusing on *why* and *how*, not just *what*)
3. **Discover** — samples observations and proposes natural model boundaries
4. **Assign** — each observation gets assigned to a model
5. **Summarize** — pyramidal compression: tier-0 summaries per model, then higher tiers compress 10:1
6. **Consolidate** — reviews all models, merges overlapping ones, renames mismatches
7. **Synthesize** — generates narrative developer notes per model with temporal bucketing (Recent, This Week, This Month, etc.)
8. **Insights** — six opinionated questions answered from the full model set
9. **Export** — writes markdown files to `.code-aware/`

## License

MIT
