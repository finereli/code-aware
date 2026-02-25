#!/usr/bin/env node

import { Command } from 'commander';
import { resolve, join } from 'path';
import { scan, sync, status } from './sync.js';

const program = new Command();

program
  .name('code-aware')
  .description('Give your coding agent architectural memory')
  .version('0.2.0');

program
  .command('scan')
  .description('First run: scan git history and generate architectural models')
  .option('-r, --repo <path>', 'Path to git repository', '.')
  .option('-n, --limit <number>', 'Maximum commits to process (default: 50 for quick scan)', '50')
  .option('--full', 'Scan full git history (no commit limit)')
  .option('-p, --parallel <number>', 'LLM parallel workers', '10')
  .action(async (opts) => {
    const repoPath = resolve(opts.repo);
    const workspace = join(repoPath, '.code-aware');
    const limit = opts.full ? 0 : parseInt(opts.limit, 10);
    const parallel = parseInt(opts.parallel, 10);

    try {
      await scan(repoPath, workspace, {
        limit,
        parallel,
        onProgress: msg => console.log(msg),
      });
    } catch (err: any) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Update models with new commits since last sync')
  .option('-r, --repo <path>', 'Path to git repository', '.')
  .option('-p, --parallel <number>', 'LLM parallel workers', '10')
  .action(async (opts) => {
    const repoPath = resolve(opts.repo);
    const workspace = join(repoPath, '.code-aware');
    const parallel = parseInt(opts.parallel, 10);

    try {
      await sync(repoPath, workspace, {
        parallel,
        onProgress: msg => console.log(msg),
      });
    } catch (err: any) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show sync status and model summary')
  .option('-r, --repo <path>', 'Path to git repository', '.')
  .action((opts) => {
    const repoPath = resolve(opts.repo);
    const workspace = join(repoPath, '.code-aware');

    try {
      const result = status(repoPath, workspace);

      if (result.lastSync === null) {
        console.log('No code-aware data found. Run "code-aware scan" first.');
        return;
      }

      console.log(`Last sync: ${result.lastSync}`);
      console.log(`Models: ${result.modelCount}`);

      if (result.isStale) {
        if (result.commitsBehind > 0) {
          console.log(`Status: STALE (${result.commitsBehind} commits behind)`);
        } else {
          console.log('Status: STALE');
        }
        console.log('Run "code-aware sync" to update.');
      } else {
        console.log('Status: UP TO DATE');
      }
    } catch (err: any) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();
