# code-aware

Give your coding agent architectural memory.

code-aware processes git history to build a mental model of your codebase — not just what exists, but why it was built that way and how it evolved. The output is a set of developer-notes-style markdown files that any coding agent can read before making changes.

## Quick Start

```bash
git clone https://github.com/finereli/code-aware.git
cd code-aware
npm install
```

Then scan any repo:

```bash
OPENAI_API_KEY=sk-... npx tsx src/index.ts scan --repo /path/to/your/repo
```

This reads the full git history, extracts architectural observations, discovers natural model boundaries, synthesizes them into narrative developer notes, and generates codebase-level insights. Takes 2-5 minutes depending on repo size.

Output lands in `/path/to/your/repo/.code-aware/`:
- `index.md` — list of all models with descriptions
- `models/*.md` — one file per architectural component
- `INSIGHTS.md` — six opinionated questions about the codebase (most surprising aspect, most elegant part, messiest area, biggest recent pivot, design philosophy, what to know before your first change)

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

After committing new work:

```bash
OPENAI_API_KEY=sk-... npx tsx src/index.ts sync --repo /path/to/your/repo
```

Only processes new commits since the last scan. Periodically re-consolidates models if enough new observations accumulate.

Check staleness without updating:

```bash
npx tsx src/index.ts status --repo /path/to/your/repo
```

## Using with Claude Code

Drop `SKILL.md` into your project or reference it in your Claude Code configuration. It tells the agent how to read and maintain the models. See [SKILL.md](SKILL.md) for details.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | required | OpenAI API key |
| `CODE_AWARE_MODEL` | `gpt-4.1-mini` | Model for observation extraction and synthesis |
| `CODE_AWARE_INSIGHTS_MODEL` | `gpt-4.1` | Model for codebase insights (uses full model for quality) |

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
