/**
 * Simple example demonstrating aiobs with OpenAI chat completions.
 *
 * Usage:
 *   OPENAI_API_KEY=your_key npx tsx example/simple-chat/index.ts
 */

import OpenAI from 'openai';
import { observer, wrapOpenAIClient } from '../../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY in environment');
    process.exit(1);
  }

  // Create and wrap OpenAI client
  const client = new OpenAI({ apiKey });
  const openai = wrapOpenAIClient(client, observer);

  // Fixed question to keep things minimal
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'In one sentence, explain what an API is.' },
  ];

  // Start observability, make the LLM call, then end and flush
  await observer.observe({
    sessionName: 'simple-chat-completion',
    labels: {
      environment: 'development',
      example: 'simple_chat',
      provider: 'openai',
    },
  });

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    max_tokens: 100,
  });

  console.log(completion.choices[0]?.message?.content?.trim());

  observer.end();
  const outputPath = await observer.flush();
  console.log(`\nObservability data written to: ${outputPath}`);
}

main().catch(console.error);
