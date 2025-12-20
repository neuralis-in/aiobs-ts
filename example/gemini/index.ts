/**
 * Simple Gemini Example with aiobs Observability using Vertex AI
 *
 * This example demonstrates how to use the aiobs library to observe
 * Gemini API calls using Google Cloud Vertex AI with gcloud authentication.
 *
 * Authentication Methods:
 *   1. Service Account JSON:
 *      export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   2. Application Default Credentials (recommended for local dev):
 *      gcloud auth application-default login
 *      export GOOGLE_CLOUD_PROJECT=your-project-id
 *
 * Usage:
 *   # With ADC (after gcloud auth application-default login)
 *   GOOGLE_CLOUD_PROJECT=your-project npx tsx example/gemini/index.ts
 *
 *   # With service account
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/creds.json npx tsx example/gemini/index.ts
 *
 *   # Optionally set region (default: us-central1)
 *   GOOGLE_CLOUD_REGION=us-east1 npx tsx example/gemini/index.ts
 */

import { observer, observe } from '../../src/index.js';
import { CredentialsManager } from './credentials-manager.js';

const MODEL = 'gemini-2.0-flash-001';

// Create credentials manager (singleton for the example)
let credsManager: CredentialsManager | null = null;

function getCredentialsManager(): CredentialsManager {
  if (!credsManager) {
    credsManager = new CredentialsManager();
  }
  return credsManager;
}

async function simpleGeneration(): Promise<string> {
  const client = getCredentialsManager().getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const result = await model.generateContent(
    'What is the capital of France? Answer in one sentence.'
  );
  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  console.log(`Response: ${text}`);
  return text;
}

const generationWithSystemInstruction = observe(async function generationWithSystemInstruction(): Promise<string> {
  const client = getCredentialsManager().getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    systemInstruction: 'You are a helpful assistant that tells short, family-friendly jokes.',
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: 'Tell me a joke' }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 100,
    },
  });
  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  console.log(`Joke: ${text}`);
  return text;
});

async function askToRemember(): Promise<string> {
  const client = getCredentialsManager().getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const result = await model.generateContent('My name is Alice. Remember that.');
  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  console.log(`Remember: ${text}`);
  return text;
}

async function askToRecall(): Promise<string> {
  const client = getCredentialsManager().getClient();
  const model = client.getGenerativeModel({ model: MODEL });

  const result = await model.generateContent('What is my name?');
  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  console.log(`Recall: ${text}`);
  return text;
}

async function multiTurnConversation(): Promise<string> {
  // First turn
  const response1 = await askToRemember();
  console.log(`Turn 1: ${response1}`);

  // Second turn with context (note: Gemini doesn't maintain context between separate calls)
  const response2 = await askToRecall();
  console.log(`Turn 2: ${response2}`);
  return response2;
}

async function main(): Promise<void> {
  console.log('Gemini Example with Vertex AI Authentication\n');

  // Start observability session with labels for filtering
  const sessionId = await observer.observe({
    sessionName: 'gemini-example',
    labels: {
      environment: 'development',
      example: 'gemini_vertexai',
      provider: 'gemini',
      model: MODEL,
    },
  });
  console.log(`\nStarted observability session: ${sessionId}\n`);

  try {
    console.log('='.repeat(50));
    console.log('1. Simple Generation');
    console.log('='.repeat(50));
    await simpleGeneration();
    console.log();

    console.log('='.repeat(50));
    console.log('2. Generation with System Instruction');
    console.log('='.repeat(50));
    await generationWithSystemInstruction();
    console.log();

    console.log('='.repeat(50));
    console.log('3. Multi-turn Conversation');
    console.log('='.repeat(50));
    await multiTurnConversation();
    console.log();
  } finally {
    // End session and flush observability data
    observer.end();
    const outputPath = await observer.flush();
    console.log(`\n✅ Observability data saved to: ${outputPath}`);
  }
}

main().catch(console.error);
