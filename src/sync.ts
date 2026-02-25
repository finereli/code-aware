import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { initDb } from './db.js';
import { loadGitCommits, loadGitIncremental, groupByWeek } from './loaders.js';
import { extractObservations } from './llm.js';
import { runTier0Summarization, runHigherTierSummarization } from './summarize.js';
import { synthesizeDirtyModels } from './pyramid.js';
import { exportModels } from './generate.js';
import { generateInsights } from './insights.js';

type ProgressFn = (msg: string) => void;

export interface SyncState {
  lastCommit: string | null;
  repoPath: string;
  lastSync: string;
  head: string | null;
}

function readSyncState(workspace: string): SyncState | null {
  const statePath = join(workspace, 'sync-state.json');
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

function writeSyncState(workspace: string, state: SyncState): void {
  const statePath = join(workspace, 'sync-state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  const lastSyncPath = join(workspace, 'last-sync');
  writeFileSync(
    lastSyncPath,
    JSON.stringify({ timestamp: state.lastSync, head: state.head }),
    'utf-8'
  );
}

/**
 * Full scan: load git history and run the complete pipeline.
 */
export async function scan(
  repoPath: string,
  workspace: string,
  options: {
    limit?: number;
    parallel?: number;
    onProgress?: ProgressFn;
  } = {}
): Promise<string[]> {
  const { limit = 500, parallel = 10, onProgress } = options;
  const absRepo = resolve(repoPath);
  const absWorkspace = resolve(workspace);
  const dbPath = join(absWorkspace, 'code-aware.db');

  mkdirSync(absWorkspace, { recursive: true });
  initDb(dbPath);

  onProgress?.(`Scanning ${absRepo} (last ${limit} commits)...`);

  const { messages, info } = loadGitCommits(absRepo, { limit });
  onProgress?.(info);

  if (messages.length === 0) {
    onProgress?.('No commits found.');
    return [];
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const byWeek = groupByWeek(messages);
  const weeks = [...byWeek.keys()].sort();
  let totalObs = 0;

  for (const week of weeks) {
    const weekMessages = byWeek.get(week)!;
    onProgress?.(`${week}: ${weekMessages.length} commits`);

    const observations = await extractObservations(weekMessages, {
      maxWorkers: parallel,
      onProgress: (completed, total, obsCount) => {
        onProgress?.(`  [${completed}/${total}] ${obsCount} obs`);
      },
    });

    const insertObs = sqlite.prepare(
      'INSERT INTO observations (text, timestamp) VALUES (?, ?)'
    );
    for (const obs of observations) {
      insertObs.run(obs.text, obs.timestamp);
    }
    totalObs += observations.length;
  }

  onProgress?.(`Extracted ${totalObs} observations`);

  const tier0 = await runTier0Summarization(sqlite, onProgress, parallel);
  const higher = await runHigherTierSummarization(sqlite, onProgress, parallel);
  if (tier0 || higher) {
    onProgress?.(`Created ${tier0} tier-0 + ${higher} higher-tier summaries`);
  }

  await synthesizeDirtyModels(sqlite, onProgress, parallel);
  const written = await exportModels(absWorkspace, sqlite, onProgress, parallel);

  const lastTimestamp = messages[messages.length - 1]?.timestamp;
  const headMatch = messages[messages.length - 1]?.content.match(/^Commit: ([a-f0-9]+)/);
  const head = headMatch?.[1] ?? null;

  writeSyncState(absWorkspace, {
    lastCommit: head,
    repoPath: absRepo,
    lastSync: new Date().toISOString(),
    head,
  });

  sqlite.close();

  if (written.length > 0) {
    onProgress?.(`Written: ${written.join(', ')}`);
  }

  await generateInsights(absWorkspace, onProgress);
  onProgress?.('Scan complete.');

  return written;
}

/**
 * Incremental sync: process only new commits since last sync.
 */
export async function sync(
  repoPath: string,
  workspace: string,
  options: {
    parallel?: number;
    onProgress?: ProgressFn;
  } = {}
): Promise<string[]> {
  const { parallel = 10, onProgress } = options;
  const absRepo = resolve(repoPath);
  const absWorkspace = resolve(workspace);
  const dbPath = join(absWorkspace, 'code-aware.db');

  if (!existsSync(dbPath)) {
    onProgress?.('No existing database. Run "scan" first.');
    return [];
  }

  const state = readSyncState(absWorkspace);
  const lastHash = state?.lastCommit ?? null;

  onProgress?.(`Syncing ${absRepo}...`);
  const { messages, newHead, count } = loadGitIncremental(absRepo, lastHash);

  if (count === 0) {
    onProgress?.('Already up to date.');
    return [];
  }

  onProgress?.(`Found ${count} new commits`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const byWeek = groupByWeek(messages);
  const weeks = [...byWeek.keys()].sort();
  let totalObs = 0;

  for (const week of weeks) {
    const weekMessages = byWeek.get(week)!;
    onProgress?.(`${week}: ${weekMessages.length} commits`);

    const observations = await extractObservations(weekMessages, {
      maxWorkers: parallel,
      onProgress: (completed, total, obsCount) => {
        onProgress?.(`  [${completed}/${total}] ${obsCount} obs`);
      },
    });

    const insertObs = sqlite.prepare(
      'INSERT INTO observations (text, timestamp) VALUES (?, ?)'
    );
    for (const obs of observations) {
      insertObs.run(obs.text, obs.timestamp);
    }
    totalObs += observations.length;
  }

  onProgress?.(`Extracted ${totalObs} observations`);

  const tier0 = await runTier0Summarization(sqlite, onProgress, parallel);
  const higher = await runHigherTierSummarization(sqlite, onProgress, parallel);
  if (tier0 || higher) {
    onProgress?.(`Created ${tier0} tier-0 + ${higher} higher-tier summaries`);
  }

  await synthesizeDirtyModels(sqlite, onProgress, parallel);
  const written = await exportModels(absWorkspace, sqlite, onProgress, parallel);

  writeSyncState(absWorkspace, {
    lastCommit: newHead,
    repoPath: absRepo,
    lastSync: new Date().toISOString(),
    head: newHead,
  });

  sqlite.close();

  if (written.length > 0) {
    onProgress?.(`Updated: ${written.join(', ')}`);
  }

  await generateInsights(absWorkspace, onProgress);
  onProgress?.('Sync complete.');

  return written;
}

/**
 * Check staleness.
 */
export function status(
  repoPath: string,
  workspace: string
): {
  isStale: boolean;
  commitsBehind: number;
  lastSync: string | null;
  lastHead: string | null;
  currentHead: string;
  modelCount: number;
} {
  const absRepo = resolve(repoPath);
  const absWorkspace = resolve(workspace);
  const dbPath = join(absWorkspace, 'code-aware.db');

  const currentHead = execSync(`git -C "${absRepo}" rev-parse HEAD`, {
    encoding: 'utf-8',
  }).trim();

  if (!existsSync(dbPath)) {
    return {
      isStale: true,
      commitsBehind: -1,
      lastSync: null,
      lastHead: null,
      currentHead,
      modelCount: 0,
    };
  }

  const state = readSyncState(absWorkspace);
  const lastHead = state?.head ?? null;
  const isStale = lastHead !== currentHead;

  let commitsBehind = 0;
  if (isStale && lastHead) {
    try {
      const log = execSync(
        `git -C "${absRepo}" log --oneline ${lastHead}..HEAD`,
        { encoding: 'utf-8' }
      );
      commitsBehind = log.trim().split('\n').filter(Boolean).length;
    } catch {
      commitsBehind = -1;
    }
  } else if (isStale) {
    commitsBehind = -1;
  }

  const sqlite = new Database(dbPath, { readonly: true });
  const modelCount = (
    sqlite.prepare('SELECT COUNT(*) as c FROM models WHERE synthesized_content IS NOT NULL').get() as { c: number }
  ).c;
  sqlite.close();

  return {
    isStale,
    commitsBehind,
    lastSync: state?.lastSync ?? null,
    lastHead,
    currentHead,
    modelCount,
  };
}
