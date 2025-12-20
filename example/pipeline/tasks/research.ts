import type OpenAI from 'openai';

export async function research(
  query: string,
  client: OpenAI,
  model: string
): Promise<string[]> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You generate brief, factual research notes.' },
    {
      role: 'user',
      content:
        'Collect 5-7 concise bullet points of facts and references (no links) ' +
        `about: ${query}. Keep each under 20 words.`,
    },
  ];

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: 300,
  });

  const text = resp.choices[0]?.message?.content ?? '';

  // Very light parsing: split by lines starting with a dash or bullet
  const notes = text
    .split('\n')
    .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim())
    .map((line) => line.replace(/^[\s\-•\t]+/, '').trim())
    .filter((n) => n);

  // Keep it to ~7 lines max to feed into the next step
  return notes.slice(0, 7);
}

