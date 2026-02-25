import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { chatCompletion } from './llm.js';

type ProgressFn = (msg: string) => void;

/**
 * Write file only if content changed.
 */
function writeIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    const existingHash = createHash('sha256').update(existing).digest('hex');
    const newHash = createHash('sha256').update(content).digest('hex');
    if (existingHash === newHash) return false;
  }
  writeFileSync(filePath, content, 'utf-8');
  return true;
}

/**
 * Render a model to markdown.
 */
function renderModelFile(name: string, description: string | null, content: string | null): string {
  const title = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
  return `# ${title}

> ${description ?? ''}

${content ?? '*No content yet.*'}
`;
}

/**
 * Generate descriptions for models that don't have one yet.
 */
async function updateModelDescriptions(
  sqlite: Database.Database,
  onProgress?: ProgressFn,
  maxWorkers = 10
): Promise<void> {
  const undescribed = sqlite
    .prepare("SELECT id, name FROM models WHERE description IS NULL OR description = ''")
    .all() as { id: number; name: string }[];

  if (undescribed.length === 0) return;

  onProgress?.(`Generating descriptions for ${undescribed.length} models...`);

  for (let i = 0; i < undescribed.length; i += maxWorkers) {
    const batch = undescribed.slice(i, i + maxWorkers);

    const results = await Promise.all(
      batch.map(async model => {
        const samples = sqlite
          .prepare('SELECT text FROM observations WHERE model_id = ? LIMIT 10')
          .all(model.id) as { text: string }[];

        const sampleText = samples.map(s => `- ${s.text}`).join('\n');
        const description = await chatCompletion(
          'Generate a concise model description (under 100 characters) based on the observations below. Return ONLY the description, nothing else.',
          `Model name: ${model.name}\n\nSample observations:\n${sampleText}`
        );
        return { id: model.id, description: description.slice(0, 100) };
      })
    );

    for (const result of results) {
      sqlite
        .prepare('UPDATE models SET description = ? WHERE id = ?')
        .run(result.description, result.id);
    }
  }
}

/**
 * Export all models to markdown files in the workspace.
 */
export async function exportModels(
  workspace: string,
  sqlite: Database.Database,
  onProgress?: ProgressFn,
  maxWorkers = 10
): Promise<string[]> {
  await updateModelDescriptions(sqlite, onProgress, maxWorkers);

  const modelsDir = join(workspace, 'models');
  mkdirSync(modelsDir, { recursive: true });

  const allModels = sqlite
    .prepare('SELECT id, name, description, synthesized_content FROM models')
    .all() as {
    id: number;
    name: string;
    description: string | null;
    synthesized_content: string | null;
  }[];

  const written: string[] = [];

  for (const model of allModels) {
    if (!model.synthesized_content) continue;

    const safeName = model.name.replace(/\//g, '-');
    const content = renderModelFile(model.name, model.description, model.synthesized_content);
    const filePath = join(modelsDir, `${safeName}.md`);
    if (writeIfChanged(filePath, content)) {
      written.push(`models/${safeName}.md`);
    }
  }

  // Write index
  const indexLines = ['# Code Awareness\n', 'Architectural models generated from git history.\n'];
  for (const model of allModels) {
    if (!model.synthesized_content) continue;
    indexLines.push(`- [${model.name}](models/${model.name}.md): ${model.description ?? ''}`);
  }
  const indexContent = indexLines.join('\n') + '\n';
  if (writeIfChanged(join(workspace, 'index.md'), indexContent)) {
    written.push('index.md');
  }

  return written;
}
