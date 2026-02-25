import OpenAI from 'openai';
import { OBSERVE_SYSTEM_PROMPT, OBSERVE_USER_PREFIX, OBSERVE_TOOL } from './prompts.js';
import type { GitMessage } from './loaders.js';

export const MODEL = process.env.CODE_AWARE_MODEL || 'gpt-4.1-mini';
const MAX_TOKENS = 10000;
const CHARS_PER_TOKEN = 4;

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI();
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

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: OBSERVE_SYSTEM_PROMPT },
      { role: 'user', content: `${OBSERVE_USER_PREFIX}\n\n${conversationText}` },
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
