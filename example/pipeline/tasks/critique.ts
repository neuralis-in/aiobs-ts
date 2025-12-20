import type OpenAI from 'openai';

export async function critique(
  draft: string,
  client: OpenAI,
  model: string
): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a careful editor improving clarity and accuracy.' },
    {
      role: 'user',
      content:
        'Critique this answer for clarity, accuracy, and completeness. ' +
        'Then return an improved version in 3-6 sentences.\n\n' +
        `Answer:\n${draft}`,
    },
  ];

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.4,
    max_tokens: 250,
  });

  return (resp.choices[0]?.message?.content ?? '').trim();
}
