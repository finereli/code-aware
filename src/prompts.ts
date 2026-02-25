// All LLM prompts centralized

export const OBSERVE_SYSTEM_PROMPT = `You are a code memory agent building a mental model of a codebase from its git history.

For each batch of commits, extract observations that would help a developer understand the system without reading every file.

Focus on:
- What components/modules exist and what they do
- How data flows between parts of the system
- API patterns, database schemas, key abstractions
- Design decisions and their rationale (when inferable from commit messages or diffs)
- Bug patterns, what was tried and failed, known fragile areas
- Dependencies and technology choices
- Invariants — things that must remain true for the system to work

BAD: "A commit was made to fix a bug" (too vague)
BAD: "Lines 45-67 of server.ts were modified" (too granular)
GOOD: "Messages are sent via POST to stage the prompt, then GET opens the SSE stream — a two-step pattern to avoid URL length limits"
GOOD: "The client uses Svelte 4 with a single-page Chat component handling message rendering, streaming, and input"
GOOD: "PIN auth was chosen over session-based auth because the app has a single user — simpler and stateless"
GOOD: "Tool call blocks were vanishing on page reload because the streaming format didn't persist them — fixed by storing blocks as JSON alongside message content"

Each observation should be a single factual sentence. Prefer observations that capture WHY something exists or HOW it evolved, not just WHAT it is.`;

export const OBSERVE_USER_PREFIX = 'Extract architectural observations from these git commits:';

export const OBSERVE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'add_observation',
    description: 'Record an architectural observation about the codebase',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The observation text, a single factual sentence',
        },
      },
      required: ['text'],
    },
  },
};

export const ASSIGN_MODEL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'assign_model',
    description: 'Assign an observation to a mental model',
    parameters: {
      type: 'object',
      properties: {
        observation_id: { type: 'integer' },
        model_name: {
          type: 'string',
          description: 'Model name: use an existing model or create a new specific one',
        },
      },
      required: ['observation_id', 'model_name'],
    },
  },
};

export const SYNTHESIZE_SYSTEM_PROMPT = `You are writing developer notes about a software system. Your output will be injected into a coding agent's context to help it understand the codebase.

Write like a senior developer's personal notes — dry, factual, specific. Include file names, function names, endpoints, and variable names when known.

Structure:
- Use markdown headers and bullet points
- Group related information under clear headings
- Lead with HOW things work and WHY they were built that way
- Include known gotchas, failed approaches, and design constraints
- Name specific files and functions, not just abstract concepts
- When something changed over time, explain what it replaced and why

Do NOT:
- Write marketing copy or use words like "robust", "sophisticated", "seamlessly", "elegant"
- Write summary paragraphs — every sentence should carry specific information
- Describe what the code does line-by-line — focus on architecture and intent
- Repeat information across time sections — each section adds new information`;

export const SUMMARIZE_SYSTEM_PROMPT = `You are a code memory agent creating concise developer notes from architectural observations.

Write like a senior developer's personal notes — dry, factual, specific. Include file names, function names, endpoints.

Rules:
- Synthesize observations into coherent paragraphs grouped by topic
- Preserve specific technical details (file paths, function names, patterns)
- Capture WHY decisions were made, not just what exists
- Note known issues, gotchas, and failed approaches
- No filler words, no marketing speak
- Every sentence should carry specific information`;
