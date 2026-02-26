import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { chatCompletion, getClient, INSIGHTS_MODEL } from './llm.js';

type ProgressFn = (msg: string) => void;

const INSIGHTS_PROMPT = `You just read the complete architectural models of a codebase, extracted from its git history. Answer these questions as a senior developer who has deeply studied this code.

1. **What's the most surprising aspect of the code?** Something that defies expectations or reveals a non-obvious design choice.

2. **What's the most elegant part?** Where does the design shine — a pattern, abstraction, or solution that's particularly well-crafted?

3. **What seems messy or fragile?** Where are the rough edges — areas that look like they'd break easily or cause confusion for new contributors?

4. **What's the most significant recent change or pivot?** What direction shift is visible in the recent commits compared to earlier ones?

5. **What's the design philosophy here?** If you had to describe the overall approach to building this system in 2-3 sentences, what would it be?

6. **What would you want to know before making your first change?** The single most important thing a new developer should understand.

Rules:
- Be opinionated, specific, and grounded in what you actually read.
- Reference specific files, patterns, and decisions.
- Don't hedge or qualify everything. Be direct.
- Start with the content immediately. No preamble like "Absolutely!", "Great question!", "Sure!", etc.
- Write in a clean, understated tone. No exclamation marks in headers or topic sentences.`;

/**
 * Generate insights from synthesized models.
 */
export async function generateInsights(
  workspace: string,
  onProgress?: ProgressFn
): Promise<string> {
  const indexPath = join(workspace, 'index.md');
  if (!existsSync(indexPath)) {
    return 'No models found. Run scan first.';
  }

  const index = readFileSync(indexPath, 'utf-8');

  // Read all model files referenced in the index
  const modelRegex = /\[([^\]]+)\]\(models\/([^)]+)\)/g;
  const modelContents: string[] = [];
  let match;

  while ((match = modelRegex.exec(index)) !== null) {
    const filePath = join(workspace, 'models', match[2]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      modelContents.push(content);
    }
  }

  if (modelContents.length === 0) {
    return 'No model content found.';
  }

  onProgress?.('Generating codebase insights...');

  const allModels = modelContents.join('\n\n---\n\n');

  // Use the stronger model for insights — this is the "wow" moment
  const client = getClient();
  const response = await client.chat.completions.create({
    model: INSIGHTS_MODEL,
    messages: [
      { role: 'system', content: INSIGHTS_PROMPT },
      { role: 'user', content: `Here are the architectural models:\n\n${allModels}` },
    ],
  });
  const insights = response.choices[0]?.message?.content?.trim() ?? '';

  const insightsPath = join(workspace, 'INSIGHTS.md');
  writeFileSync(insightsPath, `# Codebase Insights\n\n${insights}\n`, 'utf-8');
  onProgress?.('Written: INSIGHTS.md');

  return insights;
}
