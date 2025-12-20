import type OpenAI from 'openai';

export async function summarize(
  notes: string[],
  client: OpenAI,
  model: string
): Promise<string> {
  const notesText = notes.map((n) => `- ${n}`).join('\n');

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a concise, accurate technical writer.' },
    {
      role: 'user',
      content:
        'Given these notes, produce a crisp 4-6 sentence summary with no bullet points.\n\n' +
        `Notes:\n${notesText}`,
    },
  ];

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.3,
    max_tokens: 250,
  });

  return (resp.choices[0]?.message?.content ?? '').trim();
}

