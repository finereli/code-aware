import { execSync } from 'child_process';

const MAX_DIFF_CHARS = 4000;

export interface GitMessage {
  role: 'assistant';
  content: string;
  timestamp: string; // ISO 8601
}

/**
 * Parse raw git log output into structured messages.
 * Each commit becomes a message with hash, author, message, and truncated diff.
 */
export function parseGitLog(raw: string, separator: string): GitMessage[] {
  const commits = raw.split(separator).filter(s => s.trim());
  const messages: GitMessage[] = [];

  for (const block of commits) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const hash = lines[0].trim();
    const timestamp = lines[1].trim();
    const author = lines[2].trim();

    // Find where the commit message ends and diff starts
    const messageLines: string[] = [];
    let diffStart = -1;
    for (let i = 3; i < lines.length; i++) {
      if (lines[i].startsWith('diff --git')) {
        diffStart = i;
        break;
      }
      messageLines.push(lines[i]);
    }

    const commitMessage = messageLines.join('\n').trim();
    let diff = '';
    if (diffStart >= 0) {
      diff = lines.slice(diffStart).join('\n');
      if (diff.length > MAX_DIFF_CHARS) {
        diff = diff.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)';
      }
    }

    const content = [
      `Commit: ${hash}`,
      `Author: ${author}`,
      `Message: ${commitMessage}`,
      diff ? `\nDiff:\n${diff}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    messages.push({ role: 'assistant', content, timestamp });
  }

  return messages;
}

/**
 * Load all commits from a git repository.
 */
export function loadGitCommits(
  repoPath: string,
  options: { limit?: number; since?: string } = {}
): { messages: GitMessage[]; info: string } {
  const separator = '@@CODE_AWARE_SEP_7f3a2b@@';

  let cmd = `git -C "${repoPath}" log --format="${separator}%n%H%n%aI%n%aN%n%B" --patch --reverse`;
  if (options.since) cmd += ` --since="${options.since}"`;
  if (options.limit) cmd += ` -n ${options.limit}`;

  const raw = execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
  });

  const messages = parseGitLog(raw, separator);
  const info = `Loaded ${messages.length} commits from ${repoPath}`;
  return { messages, info };
}

/**
 * Load commits incrementally since a given commit hash.
 */
export function loadGitIncremental(
  repoPath: string,
  lastHash: string | null
): { messages: GitMessage[]; newHead: string; count: number } {
  const separator = '@@CODE_AWARE_SEP_7f3a2b@@';

  const newHead = execSync(`git -C "${repoPath}" rev-parse HEAD`, {
    encoding: 'utf-8',
  }).trim();

  if (lastHash === newHead) {
    return { messages: [], newHead, count: 0 };
  }

  let cmd: string;
  if (lastHash) {
    cmd = `git -C "${repoPath}" log --format="${separator}%n%H%n%aI%n%aN%n%B" --patch --reverse ${lastHash}..HEAD`;
  } else {
    cmd = `git -C "${repoPath}" log --format="${separator}%n%H%n%aI%n%aN%n%B" --patch --reverse`;
  }

  const raw = execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
  });

  const messages = parseGitLog(raw, separator);
  return { messages, newHead, count: messages.length };
}

/**
 * Get ISO week key for temporal grouping.
 */
export function getWeekKey(isoDate: string): string {
  const d = new Date(isoDate);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Group messages by ISO week.
 */
export function groupByWeek(messages: GitMessage[]): Map<string, GitMessage[]> {
  const groups = new Map<string, GitMessage[]>();
  for (const msg of messages) {
    const key = getWeekKey(msg.timestamp);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(msg);
  }
  return groups;
}
