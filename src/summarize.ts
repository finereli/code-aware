import Database from 'better-sqlite3';
import { SUMMARIZE_SYSTEM_PROMPT, ASSIGN_MODEL_TOOL } from './prompts.js';
import { chatCompletion, toolCompletion, estimateTokens } from './llm.js';

const STEP = 10;
const MAX_TOKENS = 10000;

type ProgressFn = (msg: string) => void;

// --- Model assignment ---

export async function assignModelsToObservations(
  sqlite: Database.Database,
  observationIds: number[],
  onProgress?: ProgressFn
): Promise<void> {
  if (observationIds.length === 0) return;

  const existingModels = sqlite
    .prepare('SELECT id, name, description FROM models')
    .all() as { id: number; name: string; description: string | null }[];

  const modelsText = existingModels
    .map(m => `- ${m.name}: ${m.description ?? '(no description)'}`)
    .join('\n');

  const systemPrompt = `You assign code observations to models representing parts of the system. Call assign_model for each observation.

Existing models:
${modelsText}

IMPORTANT: Actively create new models for distinct subsystems, components, or cross-cutting concerns.
Use names derived from the codebase structure — directories, files, modules, or logical groupings.

Good model names: "server", "client", "database", "streaming", "authentication", "memory-system", "deployment"
Bad model names: "system" (too broad), "misc" (meaningless), "code" (everything is code)

Every observation should be assigned. If nothing fits, create a specific new model.`;

  for (let i = 0; i < observationIds.length; i += STEP) {
    const batchIds = observationIds.slice(i, i + STEP);

    const modelsCtx = getModelsContext(sqlite);
    const observations = sqlite
      .prepare(`SELECT id, text FROM observations WHERE id IN (${batchIds.map(() => '?').join(',')})`)
      .all(...batchIds) as { id: number; text: string }[];

    const obsText = observations.map(o => `[${o.id}] ${o.text}`).join('\n');
    const prompt = `${modelsCtx}\n\nAssign each observation to the most appropriate model:\n\n${obsText}`;

    const toolCalls = await toolCompletion(systemPrompt, prompt, [ASSIGN_MODEL_TOOL]);

    for (const call of toolCalls) {
      if (call.function.name === 'assign_model') {
        const args = JSON.parse(call.function.arguments);
        const obsId = args.observation_id;
        const modelName = String(args.model_name).toLowerCase().trim().replace(/[\s\/]+/g, '-');

        let model = sqlite
          .prepare('SELECT id FROM models WHERE name = ?')
          .get(modelName) as { id: number } | undefined;

        if (!model) {
          const result = sqlite
            .prepare('INSERT INTO models (name, is_base, content_dirty) VALUES (?, 0, 1)')
            .run(modelName);
          model = { id: Number(result.lastInsertRowid) };
        }

        sqlite.prepare('UPDATE observations SET model_id = ? WHERE id = ?').run(model.id, obsId);
        sqlite.prepare('UPDATE models SET content_dirty = 1 WHERE id = ?').run(model.id);
      }
    }

    onProgress?.(`  Assigned batch ${Math.floor(i / STEP) + 1}/${Math.ceil(observationIds.length / STEP)}`);
  }
}

function getModelsContext(sqlite: Database.Database): string {
  const models = sqlite
    .prepare('SELECT id, name, description FROM models')
    .all() as { id: number; name: string; description: string | null }[];

  const lines: string[] = ['Available models:'];
  for (const m of models) {
    lines.push(`\n### ${m.name}`);
    lines.push(`Purpose: ${m.description ?? '(undefined)'}`);

    const samples = sqlite
      .prepare('SELECT text FROM observations WHERE model_id = ? ORDER BY timestamp DESC LIMIT 5')
      .all(m.id) as { text: string }[];

    if (samples.length > 0) {
      lines.push('Examples:');
      for (const s of samples) {
        lines.push(`  - ${s.text}`);
      }
    }
  }
  return lines.join('\n');
}

// --- Summarization ---

async function summarizeChunk(
  obsTexts: string[],
  modelName: string,
  modelDescription: string
): Promise<string> {
  const obsText = obsTexts.map(t => `- ${t}`).join('\n');

  const system = `${SUMMARIZE_SYSTEM_PROMPT}

Model: ${modelName}
Purpose: ${modelDescription}

Only include information relevant to this model's purpose. Omit misplaced observations.`;

  return chatCompletion(system, `Synthesize these observations into developer notes:\n\n${obsText}`);
}

async function summarizeTexts(
  texts: string[],
  modelName: string,
  modelDescription: string
): Promise<string> {
  const combined = texts.join('\n\n---\n\n');

  const system = `${SUMMARIZE_SYSTEM_PROMPT}

Model: ${modelName}
Purpose: ${modelDescription}

Merge these developer notes into one higher-level summary, deduplicating and increasing abstraction. Preserve specific file names, function names, and technical details.`;

  return chatCompletion(system, combined);
}

function chunkObservationTexts(texts: string[], maxTokens = MAX_TOKENS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    if (currentTokens + tokens > maxTokens && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(text);
    currentTokens += tokens;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function summarizeObservations(
  obsTexts: string[],
  modelName: string,
  modelDescription: string
): Promise<string> {
  const chunks = chunkObservationTexts(obsTexts);
  if (chunks.length === 1) {
    return summarizeChunk(chunks[0], modelName, modelDescription);
  }

  const chunkSummaries = await Promise.all(
    chunks.map(chunk => summarizeChunk(chunk, modelName, modelDescription))
  );
  return summarizeTexts(chunkSummaries, modelName, modelDescription);
}

// --- Tier-0 summarization ---

export async function runTier0Summarization(
  sqlite: Database.Database,
  onProgress?: ProgressFn,
  maxWorkers = 10
): Promise<number> {
  const unassigned = sqlite
    .prepare('SELECT id FROM observations WHERE model_id IS NULL ORDER BY id')
    .all() as { id: number }[];

  if (unassigned.length > 0) {
    onProgress?.(`Assigning ${unassigned.length} observations to models...`);
    await assignModelsToObservations(
      sqlite,
      unassigned.map(o => o.id),
      onProgress
    );
  }

  const modelRows = sqlite.prepare('SELECT id, name, description FROM models').all() as {
    id: number;
    name: string;
    description: string | null;
  }[];

  interface Task {
    modelId: number;
    modelName: string;
    modelDesc: string;
    obsTexts: string[];
    obsIds: number[];
    startTs: string;
    endTs: string;
  }

  const tasks: Task[] = [];

  for (const model of modelRows) {
    const observations = sqlite
      .prepare('SELECT id, text, timestamp FROM observations WHERE model_id = ? ORDER BY timestamp')
      .all(model.id) as { id: number; text: string; timestamp: string }[];

    const existingCount = (
      sqlite
        .prepare('SELECT COUNT(*) as c FROM summaries WHERE tier = 0 AND model_id = ?')
        .get(model.id) as { c: number }
    ).c;

    const summarizedCount = existingCount * STEP;
    const unsummarized = observations.slice(summarizedCount);

    for (let i = 0; i + STEP <= unsummarized.length; i += STEP) {
      const chunk = unsummarized.slice(i, i + STEP);
      tasks.push({
        modelId: model.id,
        modelName: model.name,
        modelDesc: model.description ?? '',
        obsTexts: chunk.map(o => o.text),
        obsIds: chunk.map(o => o.id),
        startTs: chunk[0].timestamp,
        endTs: chunk[chunk.length - 1].timestamp,
      });
    }
  }

  if (tasks.length === 0) return 0;
  onProgress?.(`Creating ${tasks.length} tier-0 summaries...`);

  let completed = 0;
  for (let i = 0; i < tasks.length; i += maxWorkers) {
    const batch = tasks.slice(i, i + maxWorkers);
    const results = await Promise.all(
      batch.map(async task => ({
        ...task,
        text: await summarizeObservations(task.obsTexts, task.modelName, task.modelDesc),
      }))
    );

    for (const result of results) {
      const res = sqlite
        .prepare(
          'INSERT INTO summaries (model_id, tier, text, start_timestamp, end_timestamp, is_dirty) VALUES (?, 0, ?, ?, ?, 0)'
        )
        .run(result.modelId, result.text, result.startTs, result.endTs);

      const summaryId = Number(res.lastInsertRowid);
      const insertSource = sqlite.prepare(
        'INSERT INTO summary_sources (summary_id, source_type, source_id) VALUES (?, ?, ?)'
      );
      for (const obsId of result.obsIds) {
        insertSource.run(summaryId, 'observation', obsId);
      }

      sqlite.prepare('UPDATE models SET content_dirty = 1 WHERE id = ?').run(result.modelId);
      completed++;
      onProgress?.(`  [${completed}/${tasks.length}] completed`);
    }
  }

  return tasks.length;
}

// --- Higher-tier summarization ---

export async function runHigherTierSummarization(
  sqlite: Database.Database,
  onProgress?: ProgressFn,
  maxWorkers = 10,
  maxTier?: number
): Promise<number> {
  let totalCreated = 0;
  let tier = 0;

  while (true) {
    if (maxTier !== undefined && tier >= maxTier) break;

    const models = sqlite.prepare('SELECT id, name, description FROM models').all() as {
      id: number;
      name: string;
      description: string | null;
    }[];

    interface HigherTask {
      modelId: number;
      modelName: string;
      modelDesc: string;
      newTier: number;
      startTs: string;
      endTs: string;
      childTexts: string[];
      childIds: number[];
    }

    const tasks: HigherTask[] = [];

    for (const model of models) {
      const tierSummaries = sqlite
        .prepare(
          'SELECT id, text, start_timestamp, end_timestamp FROM summaries WHERE model_id = ? AND tier = ? ORDER BY start_timestamp'
        )
        .all(model.id, tier) as {
        id: number;
        text: string;
        start_timestamp: string;
        end_timestamp: string;
      }[];

      const unsummarized = tierSummaries.filter(s => {
        const alreadySummarized = sqlite
          .prepare(
            'SELECT 1 FROM summaries WHERE model_id = ? AND tier = ? AND start_timestamp <= ? AND end_timestamp >= ?'
          )
          .get(model.id, tier + 1, s.start_timestamp, s.end_timestamp);
        return !alreadySummarized;
      });

      if (unsummarized.length < STEP) continue;

      for (let i = 0; i + STEP <= unsummarized.length; i += STEP) {
        const chunk = unsummarized.slice(i, i + STEP);
        tasks.push({
          modelId: model.id,
          modelName: model.name,
          modelDesc: model.description ?? '',
          newTier: tier + 1,
          startTs: chunk[0].start_timestamp,
          endTs: chunk[chunk.length - 1].end_timestamp,
          childTexts: chunk.map(s => s.text),
          childIds: chunk.map(s => s.id),
        });
      }
    }

    if (tasks.length === 0) break;
    onProgress?.(`T${tier + 1}: ${tasks.length} summaries across models...`);

    let completed = 0;
    for (let i = 0; i < tasks.length; i += maxWorkers) {
      const batch = tasks.slice(i, i + maxWorkers);
      const results = await Promise.all(
        batch.map(async task => ({
          ...task,
          text: await summarizeTexts(task.childTexts, task.modelName, task.modelDesc),
        }))
      );

      for (const result of results) {
        const res = sqlite
          .prepare(
            'INSERT INTO summaries (model_id, tier, text, start_timestamp, end_timestamp, is_dirty) VALUES (?, ?, ?, ?, ?, 0)'
          )
          .run(result.modelId, result.newTier, result.text, result.startTs, result.endTs);

        const summaryId = Number(res.lastInsertRowid);
        const insertSource = sqlite.prepare(
          'INSERT INTO summary_sources (summary_id, source_type, source_id) VALUES (?, ?, ?)'
        );
        for (const childId of result.childIds) {
          insertSource.run(summaryId, 'summary', childId);
        }

        sqlite.prepare('UPDATE models SET content_dirty = 1 WHERE id = ?').run(result.modelId);
        totalCreated++;
        completed++;
        onProgress?.(`  [${completed}/${tasks.length}] completed`);
      }
    }

    tier++;
  }

  return totalCreated;
}
