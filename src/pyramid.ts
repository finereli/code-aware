import Database from 'better-sqlite3';
import { SYNTHESIZE_SYSTEM_PROMPT } from './prompts.js';
import { chatCompletion } from './llm.js';

type ProgressFn = (msg: string) => void;

const TIME_BUCKETS: [string, number | null][] = [
  ['Recent (last 3 days)', 3],
  ['This Week', 7],
  ['This Month', 30],
  ['This Quarter', 90],
  ['Older', null],
];

interface TimedItem {
  endTimestamp: string;
  startTimestamp?: string;
  text: string;
  tier: number;
}

/**
 * Bucket items by time relative to a reference date.
 */
function bucketByTime(
  items: TimedItem[],
  refDate: Date
): Map<string, TimedItem[]> {
  const buckets = new Map<string, TimedItem[]>();
  for (const [label] of TIME_BUCKETS) {
    buckets.set(label, []);
  }

  const refMs = refDate.getTime();
  const DAY = 86400000;

  for (const item of items) {
    const ts = new Date(item.endTimestamp).getTime();

    let prevCutoff = refMs;
    for (const [label, days] of TIME_BUCKETS) {
      const cutoff = days === null ? -Infinity : refMs - days * DAY;

      if (days === null) {
        if (ts < prevCutoff) {
          buckets.get(label)!.push(item);
        }
      } else if (ts > cutoff && ts <= prevCutoff) {
        buckets.get(label)!.push(item);
      }
      prevCutoff = cutoff;
    }
  }

  return buckets;
}

/**
 * Get non-overlapping summaries from the pyramid.
 * Higher tiers take precedence to avoid content duplication.
 */
function getNonOverlapping(
  byTier: Map<number, TimedItem[]>
): TimedItem[] {
  const result: TimedItem[] = [];
  let higherMaxEnd: number | null = null;

  const tiers = [...byTier.keys()].sort((a, b) => b - a);

  for (const tier of tiers) {
    const items = byTier.get(tier)!;
    const sorted = [...items].sort(
      (a, b) => new Date(b.endTimestamp).getTime() - new Date(a.endTimestamp).getTime()
    );

    let currentMax: number | null = null;

    for (const item of sorted) {
      const end = new Date(item.endTimestamp).getTime();
      if (higherMaxEnd === null || end > higherMaxEnd) {
        result.push(item);
        currentMax = currentMax === null ? end : Math.max(currentMax, end);
      }
    }

    if (currentMax !== null) {
      higherMaxEnd = higherMaxEnd === null ? currentMax : Math.max(higherMaxEnd, currentMax);
    }
  }

  return result;
}

/**
 * Synthesize a single model into narrative developer notes with temporal sections.
 */
async function synthesizeModel(
  name: string,
  description: string,
  byTier: Map<number, TimedItem[]>,
  unsummarizedObs: { text: string; timestamp: string }[],
  refDate: Date
): Promise<string | null> {
  const allItems = getNonOverlapping(byTier);

  for (const obs of unsummarizedObs) {
    allItems.push({
      endTimestamp: obs.timestamp ?? refDate.toISOString(),
      text: obs.text,
      tier: -1,
    });
  }

  if (allItems.length === 0) return null;

  const buckets = bucketByTime(allItems, refDate);

  const sections: string[] = [];
  for (const [label] of TIME_BUCKETS) {
    const items = buckets.get(label)!;
    if (items.length === 0) continue;

    const sorted = [...items].sort(
      (a, b) => new Date(b.endTimestamp).getTime() - new Date(a.endTimestamp).getTime()
    );
    const content = sorted
      .map(i => `[${i.endTimestamp.slice(0, 10)}] ${i.text}`)
      .join('\n');
    sections.push(`### ${label}\n${content}`);
  }

  if (sections.length === 0) return null;

  const prompt = `Synthesize this information about '${name}' into coherent developer notes.

Model purpose: ${description || 'Not specified'}
Reference date: ${refDate.toISOString().slice(0, 10)}

Content is organized by recency. Rules:
- Organize by topic, not by time — group related information together
- Lead with the current state of each topic, then mention how it evolved if relevant
- Include specific file names, function names, endpoints, variable names
- Capture WHY things were built the way they were — design rationale, constraints, failed alternatives
- Note invariants — things that must remain true for the system to work
- Note gotchas — non-obvious things that would trip up a developer making changes
- Newer details override older ones — describe current state, not historical state
- No filler, no marketing speak — every sentence carries specific information
- No summary paragraph at the end

Content:
${sections.join('\n\n')}

Write developer notes for '${name}':`;

  return chatCompletion(SYNTHESIZE_SYSTEM_PROMPT, prompt);
}

/**
 * Synthesize all dirty models.
 */
export async function synthesizeDirtyModels(
  sqlite: Database.Database,
  onProgress?: ProgressFn,
  maxWorkers = 10
): Promise<number> {
  const dirtyModels = sqlite
    .prepare('SELECT id, name, description FROM models WHERE content_dirty = 1')
    .all() as { id: number; name: string; description: string | null }[];

  if (dirtyModels.length === 0) return 0;
  onProgress?.(`Synthesizing ${dirtyModels.length} models...`);

  const refDate = new Date();
  let completed = 0;

  for (let i = 0; i < dirtyModels.length; i += maxWorkers) {
    const batch = dirtyModels.slice(i, i + maxWorkers);

    const results = await Promise.all(
      batch.map(async model => {
        const allSummaries = sqlite
          .prepare(
            'SELECT tier, text, start_timestamp, end_timestamp FROM summaries WHERE model_id = ? ORDER BY tier DESC, start_timestamp DESC'
          )
          .all(model.id) as {
          tier: number;
          text: string;
          start_timestamp: string;
          end_timestamp: string;
        }[];

        const byTier = new Map<number, TimedItem[]>();
        for (const s of allSummaries) {
          if (!byTier.has(s.tier)) byTier.set(s.tier, []);
          byTier.get(s.tier)!.push({
            endTimestamp: s.end_timestamp,
            startTimestamp: s.start_timestamp,
            text: s.text,
            tier: s.tier,
          });
        }

        const tier0Summaries = byTier.get(0) ?? [];
        let lastSummarizedTs: string | null = null;
        for (const s of tier0Summaries) {
          if (!lastSummarizedTs || s.endTimestamp > lastSummarizedTs) {
            lastSummarizedTs = s.endTimestamp;
          }
        }

        let unsummarized: { text: string; timestamp: string }[];
        if (lastSummarizedTs) {
          unsummarized = sqlite
            .prepare(
              'SELECT text, timestamp FROM observations WHERE model_id = ? AND timestamp > ? ORDER BY timestamp'
            )
            .all(model.id, lastSummarizedTs) as { text: string; timestamp: string }[];
        } else {
          unsummarized = sqlite
            .prepare('SELECT text, timestamp FROM observations WHERE model_id = ? ORDER BY timestamp')
            .all(model.id) as { text: string; timestamp: string }[];
        }

        const content = await synthesizeModel(
          model.name,
          model.description ?? '',
          byTier,
          unsummarized,
          refDate
        );

        return { modelId: model.id, name: model.name, content };
      })
    );

    for (const result of results) {
      sqlite
        .prepare('UPDATE models SET synthesized_content = ?, content_dirty = 0 WHERE id = ?')
        .run(result.content, result.modelId);
      completed++;
      onProgress?.(`  [${completed}/${dirtyModels.length}] ${result.name}`);
    }
  }

  return dirtyModels.length;
}
