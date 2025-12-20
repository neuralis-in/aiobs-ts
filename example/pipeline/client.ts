import OpenAI from 'openai';

export function makeClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY in environment');
    process.exit(1);
  }
  return new OpenAI({ apiKey });
}

export function defaultModel(): string {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}

