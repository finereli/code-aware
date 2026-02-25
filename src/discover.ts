import Database from 'better-sqlite3';
import { toolCompletion, chatCompletion } from './llm.js';

type ProgressFn = (msg: string) => void;

const DISCOVER_TOOL = {
  type: 'function' as const,
  function: {
    name: 'create_model',
    description: 'Create a model representing a distinct component or subsystem of the codebase',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short lowercase name with dashes (e.g. "auth", "streaming", "database")',
        },
        description: {
          type: 'string',
          description: 'One-line description of what this model covers (under 100 chars)',
        },
      },
      required: ['name', 'description'],
    },
  },
};

const DISCOVER_SYSTEM_PROMPT = `You are analyzing architectural observations from a codebase to discover its major components and subsystems.

Based on the observations below, identify 4-10 distinct models that together cover the codebase. Each model should represent a meaningful architectural component, subsystem, or cross-cutting concern.

Good models: specific to what's actually in the code. "streaming" for a system with SSE, "auth" for auth logic, "scheduler" for cron jobs.
Bad models: generic labels like "utils", "misc", "core". Also bad: too granular ("button-component") or too broad ("code").

Think about what a developer would want to look up: "how does auth work?", "what's the database schema?", "how is deployment configured?"

Call create_model for each model you want to create.`;

/**
 * Discover models from a sample of observations.
 * Called once after the first batch of observations is extracted.
 */
export async function discoverModels(
  sqlite: Database.Database,
  onProgress?: ProgressFn
): Promise<number> {
  const existing = sqlite
    .prepare('SELECT COUNT(*) as c FROM models')
    .get() as { c: number };

  if (existing.c > 0) {
    onProgress?.(`Models already exist (${existing.c}), skipping discovery.`);
    return existing.c;
  }

  // Sample observations for discovery
  const observations = sqlite
    .prepare('SELECT text FROM observations ORDER BY RANDOM() LIMIT 80')
    .all() as { text: string }[];

  if (observations.length === 0) return 0;

  onProgress?.(`Discovering models from ${observations.length} observations...`);

  const obsText = observations.map(o => `- ${o.text}`).join('\n');

  const toolCalls = await toolCompletion(
    DISCOVER_SYSTEM_PROMPT,
    `Here are the observations:\n\n${obsText}`,
    [DISCOVER_TOOL]
  );

  let created = 0;
  for (const call of toolCalls) {
    if (call.function.name === 'create_model') {
      const args = JSON.parse(call.function.arguments);
      const name = String(args.name).toLowerCase().trim().replace(/[\s\/]+/g, '-');
      const description = String(args.description).slice(0, 100);

      try {
        sqlite
          .prepare('INSERT INTO models (name, description, content_dirty) VALUES (?, ?, 1)')
          .run(name, description);
        created++;
        onProgress?.(`  Created model: ${name} — ${description}`);
      } catch {
        // Duplicate name, skip
      }
    }
  }

  onProgress?.(`Discovered ${created} models.`);
  return created;
}

// --- Consolidation ---

const CONSOLIDATE_SYSTEM_PROMPT = `You are reviewing the mental models of a codebase to check if they need reorganization.

For each model, you see its name, description, observation count, and sample observations.

Decide if any models should be:
- MERGED: two models that overlap significantly and should become one
- SPLIT: one model that covers too many unrelated things
- RENAMED: a model whose name doesn't match its actual content
- KEPT: model is fine as-is

Only suggest changes that clearly improve organization. When in doubt, keep things as they are.

Return your recommendations as a structured analysis. Be specific about which models and why.`;

const CONSOLIDATE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'reorganize',
    description: 'Propose a model reorganization action',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['merge', 'split', 'rename', 'delete'],
          description: 'The type of reorganization',
        },
        source_models: {
          type: 'array',
          items: { type: 'string' },
          description: 'Model names involved (source for merge, the model for split/rename/delete)',
        },
        target_name: {
          type: 'string',
          description: 'New model name (for merge target or rename)',
        },
        target_description: {
          type: 'string',
          description: 'New description for the resulting model',
        },
        reason: {
          type: 'string',
          description: 'Why this reorganization improves the model structure',
        },
      },
      required: ['action', 'source_models', 'reason'],
    },
  },
};

interface Reorganization {
  action: 'merge' | 'split' | 'rename' | 'delete';
  sourceModels: string[];
  targetName?: string;
  targetDescription?: string;
  reason: string;
}

/**
 * Analyze models and propose consolidation actions.
 */
export async function consolidateModels(
  sqlite: Database.Database,
  onProgress?: ProgressFn
): Promise<number> {
  const models = sqlite
    .prepare('SELECT id, name, description FROM models')
    .all() as { id: number; name: string; description: string | null }[];

  if (models.length <= 2) {
    onProgress?.('Too few models for consolidation.');
    return 0;
  }

  // Build context for each model
  const modelContexts: string[] = [];
  for (const model of models) {
    const obsCount = (
      sqlite
        .prepare('SELECT COUNT(*) as c FROM observations WHERE model_id = ?')
        .get(model.id) as { c: number }
    ).c;

    const samples = sqlite
      .prepare('SELECT text FROM observations WHERE model_id = ? ORDER BY RANDOM() LIMIT 5')
      .all(model.id) as { text: string }[];

    modelContexts.push([
      `### ${model.name} (${obsCount} observations)`,
      `Description: ${model.description ?? '(none)'}`,
      'Samples:',
      ...samples.map(s => `  - ${s.text}`),
    ].join('\n'));
  }

  onProgress?.(`Analyzing ${models.length} models for consolidation...`);

  const toolCalls = await toolCompletion(
    CONSOLIDATE_SYSTEM_PROMPT,
    `Current models:\n\n${modelContexts.join('\n\n')}`,
    [CONSOLIDATE_TOOL]
  );

  const actions: Reorganization[] = [];
  for (const call of toolCalls) {
    if (call.function.name === 'reorganize') {
      const args = JSON.parse(call.function.arguments);
      actions.push({
        action: args.action,
        sourceModels: args.source_models,
        targetName: args.target_name,
        targetDescription: args.target_description,
        reason: args.reason,
      });
    }
  }

  if (actions.length === 0) {
    onProgress?.('No consolidation needed.');
    return 0;
  }

  let applied = 0;
  for (const action of actions) {
    onProgress?.(`  ${action.action}: ${action.sourceModels.join(' + ')} → ${action.targetName ?? '(remove)'} — ${action.reason}`);

    if (action.action === 'merge' && action.targetName && action.sourceModels.length >= 2) {
      applied += applyMerge(sqlite, action);
    } else if (action.action === 'rename' && action.targetName && action.sourceModels.length === 1) {
      applied += applyRename(sqlite, action);
    } else if (action.action === 'delete' && action.sourceModels.length >= 1) {
      applied += applyDelete(sqlite, action);
    }
    // Split is complex — skip for now, flag for manual review
  }

  onProgress?.(`Applied ${applied} consolidation actions.`);
  return applied;
}

function applyMerge(sqlite: Database.Database, action: Reorganization): number {
  const targetName = action.targetName!;
  const targetDesc = action.targetDescription ?? '';

  // Create or get target model
  let target = sqlite
    .prepare('SELECT id FROM models WHERE name = ?')
    .get(targetName) as { id: number } | undefined;

  if (!target) {
    const res = sqlite
      .prepare('INSERT INTO models (name, description, content_dirty) VALUES (?, ?, 1)')
      .run(targetName, targetDesc);
    target = { id: Number(res.lastInsertRowid) };
  } else {
    sqlite
      .prepare('UPDATE models SET description = ?, content_dirty = 1 WHERE id = ?')
      .run(targetDesc, target.id);
  }

  // Move observations from source models to target
  for (const sourceName of action.sourceModels) {
    if (sourceName === targetName) continue;

    const source = sqlite
      .prepare('SELECT id FROM models WHERE name = ?')
      .get(sourceName) as { id: number } | undefined;

    if (!source) continue;

    sqlite
      .prepare('UPDATE observations SET model_id = ? WHERE model_id = ?')
      .run(target.id, source.id);

    // Delete old summaries and their sources — they'll be regenerated
    const oldSummaryIds = sqlite
      .prepare('SELECT id FROM summaries WHERE model_id = ?')
      .all(source.id) as { id: number }[];
    for (const s of oldSummaryIds) {
      sqlite.prepare('DELETE FROM summary_sources WHERE summary_id = ?').run(s.id);
    }
    sqlite.prepare('DELETE FROM summaries WHERE model_id = ?').run(source.id);
    sqlite.prepare('DELETE FROM models WHERE id = ?').run(source.id);
  }

  return 1;
}

function applyRename(sqlite: Database.Database, action: Reorganization): number {
  const oldName = action.sourceModels[0];
  const newName = action.targetName!;

  const model = sqlite
    .prepare('SELECT id FROM models WHERE name = ?')
    .get(oldName) as { id: number } | undefined;

  if (!model) return 0;

  sqlite
    .prepare('UPDATE models SET name = ?, description = COALESCE(?, description), content_dirty = 1 WHERE id = ?')
    .run(newName, action.targetDescription ?? null, model.id);

  return 1;
}

function applyDelete(sqlite: Database.Database, action: Reorganization): number {
  let deleted = 0;
  for (const name of action.sourceModels) {
    const model = sqlite
      .prepare('SELECT id FROM models WHERE name = ?')
      .get(name) as { id: number } | undefined;

    if (!model) continue;

    // Unassign observations rather than deleting them
    sqlite.prepare('UPDATE observations SET model_id = NULL WHERE model_id = ?').run(model.id);
    const oldSummaryIds = sqlite
      .prepare('SELECT id FROM summaries WHERE model_id = ?')
      .all(model.id) as { id: number }[];
    for (const s of oldSummaryIds) {
      sqlite.prepare('DELETE FROM summary_sources WHERE summary_id = ?').run(s.id);
    }
    sqlite.prepare('DELETE FROM summaries WHERE model_id = ?').run(model.id);
    sqlite.prepare('DELETE FROM models WHERE id = ?').run(model.id);
    deleted++;
  }
  return deleted;
}
