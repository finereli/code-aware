import OpenAI from 'openai';
import { OBSERVE_SYSTEM_PROMPT, OBSERVE_USER_PREFIX, OBSERVE_TOOL } from './prompts.js';
import type { GitMessage } from './loaders.js';

/**
 * Auto-detect LLM provider from available API keys.
 * Priority: CODE_AWARE_MODEL env var > OPENAI_API_KEY > ANTHROPIC_API_KEY
 */
interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel: string;
  defaultInsightsModel: string;
  name: string;
}

function detectProvider(): ProviderConfig {
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      defaultModel: 'gpt-4.1-mini',
      defaultInsightsModel: 'gpt-4.1',
      name: 'OpenAI',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com/v1/',
      defaultModel: 'claude-haiku-4',
      defaultInsightsModel: 'claude-sonnet-4-20250514',
      name: 'Anthropic',
    };
  }
  // Fall back to OpenAI SDK defaults (will error if no key is set)
  return {
    apiKey: '',
    defaultModel: 'gpt-4.1-mini',
    defaultInsightsModel: 'gpt-4.1',
    name: 'OpenAI',
  };
}

const provider = detectProvider();
export const MODEL = process.env.CODE_AWARE_MODEL || provider.defaultModel;
export const INSIGHTS_MODEL = process.env.CODE_AWARE_INSIGHTS_MODEL || provider.defaultInsightsModel;

const MAX_TOKENS = 10000;
const CHARS_PER_TOKEN = 4;

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!_client) {
    const opts: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: provider.apiKey,
    };
    if (provider.baseURL) {
      opts.baseURL = provider.baseURL;
    }
    _client = new OpenAI(opts);
    // Log which provider we're using (visible in scan output)
    if (provider.apiKey) {
      console.log(`Using ${provider.name} (${MODEL})`);
    }
  }
  return _client;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Chunk messages to fit within token limits.
 */
export function chunkMessages(messages: GitMessage[], maxTokens = MAX_TOKENS): GitMessage[][] {
  const chunks: GitMessage[][] = [];
  let current: GitMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = estimateTokens(msg.content);
    if (currentTokens + msgTokens > maxTokens && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += msgTokens;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface Observation {
  text: string;
  timestamp: string | null;
}

/**
 * Process a single chunk through the LLM to extract observations.
 */
async function processChunk(chunk: GitMessage[]): Promise<Observation[]> {
  const client = getClient();
  const chunkTimestamp = chunk[chunk.length - 1]?.timestamp ?? null;
  const conversationText = chunk.map(m => `assistant: ${m.content}`).join('\n');

  // Provide temporal context so the model doesn't assume commit dates are "current"
  const today = new Date().toISOString().slice(0, 10);
  const commitDates = chunk
    .map(m => m.timestamp?.slice(0, 10))
    .filter(Boolean) as string[];
  const earliest = commitDates[0];
  const latest = commitDates[commitDates.length - 1];
  const dateContext = earliest
    ? `Today's date: ${today}. These commits are from ${earliest} to ${latest}. Describe what was true at the time of these commits — do not label past dates as "current".\n\n`
    : '';

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: OBSERVE_SYSTEM_PROMPT },
      { role: 'user', content: `${dateContext}${OBSERVE_USER_PREFIX}\n\n${conversationText}` },
    ],
    tools: [OBSERVE_TOOL],
    tool_choice: 'auto',
  });

  const observations: Observation[] = [];
  for (const toolCall of response.choices[0]?.message?.tool_calls ?? []) {
    if (toolCall.function.name === 'add_observation') {
      const args = JSON.parse(toolCall.function.arguments);
      observations.push({ text: args.text, timestamp: chunkTimestamp });
    }
  }
  return observations;
}

/**
 * Extract observations from messages with parallel processing.
 */
export async function extractObservations(
  messages: GitMessage[],
  options: {
    maxWorkers?: number;
    onProgress?: (completed: number, total: number, obsCount: number) => void;
  } = {}
): Promise<Observation[]> {
  const { maxWorkers = 10, onProgress } = options;
  const chunks = chunkMessages(messages);
  if (chunks.length === 0) return [];

  const allObservations: Observation[][] = new Array(chunks.length);
  let completed = 0;

  for (let i = 0; i < chunks.length; i += maxWorkers) {
    const batch = chunks.slice(i, i + maxWorkers);
    const results = await Promise.all(batch.map(chunk => processChunk(chunk)));

    for (let j = 0; j < results.length; j++) {
      allObservations[i + j] = results[j];
      completed++;
      onProgress?.(completed, chunks.length, results[j].length);
    }
  }

  return allObservations.flat();
}

/**
 * Generic chat completion.
 */
export async function chatCompletion(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });
  return response.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * Tool-calling completion for model assignment.
 */
export async function toolCompletion(
  systemPrompt: string,
  userContent: string,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    tools,
    tool_choice: 'auto',
  });
  return response.choices[0]?.message?.tool_calls ?? [];
}
