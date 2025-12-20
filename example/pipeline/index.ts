/**
 * Pipeline example demonstrating multi-step LLM workflow with observability.
 *
 * This example shows:
 * - Multi-step pipeline (research → summarize → critique)
 * - Session labels for filtering
 * - Optional GCS export
 *
 * Usage:
 *   # Basic usage (local file export)
 *   OPENAI_API_KEY=your_key npx tsx example/pipeline/index.ts
 *
 *   # With custom query
 *   OPENAI_API_KEY=your_key npx tsx example/pipeline/index.ts "What is quantum computing?"
 *
 *   # Export to GCS
 *   OPENAI_API_KEY=your_key AIOBS_GCS_BUCKET=my-bucket npx tsx example/pipeline/index.ts --gcs
 */

import OpenAI from 'openai';
import { observer, wrapOpenAIClient, GCSExporter } from '../../src/index.js';
import { makeClient, defaultModel } from './client.js';
import { research } from './tasks/research.js';
import { summarize } from './tasks/summarize.js';
import { critique } from './tasks/critique.js';

async function main(query?: string, useGcs: boolean = false): Promise<void> {
  const baseClient = makeClient();
  const client = wrapOpenAIClient(baseClient, observer);
  const model = defaultModel();

  // Start a single observability session for the whole pipeline
  await observer.observe({
    sessionName: 'pipeline-example',
    apiKey: process.env.AIOBS_API_KEY,
    labels: {
      environment: 'development',
      example: 'pipeline',
      provider: 'openai',
      pipeline_type: 'research_summarize_critique',
    },
  });

  try {
    const q = query ?? 'In one sentence, explain what an API is.';
    console.log(`Query: ${q}\n`);

    const notes = await research(q, client as unknown as OpenAI, model);
    console.log('Notes:');
    for (const n of notes) {
      console.log(`- ${n}`);
    }
    console.log();

    const draft = await summarize(notes, client as unknown as OpenAI, model);
    console.log('Draft:\n' + draft + '\n');

    const improved = await critique(draft, client as unknown as OpenAI, model);
    console.log('Improved:\n' + improved + '\n');
  } finally {
    observer.end();

    if (useGcs) {
      // Export to Google Cloud Storage
      // Set env vars: AIOBS_GCS_BUCKET, AIOBS_GCS_PREFIX (optional), AIOBS_GCS_PROJECT (optional)
      const bucket = process.env.AIOBS_GCS_BUCKET;
      if (!bucket) {
        console.error('Missing AIOBS_GCS_BUCKET environment variable');
        process.exit(1);
      }

      const exporter = new GCSExporter({
        bucket,
        prefix: process.env.AIOBS_GCS_PREFIX ?? 'traces/',
        project: process.env.AIOBS_GCS_PROJECT,
      });

      const result = await observer.flush({ exporter });
      if (result && typeof result === 'object' && 'destination' in result) {
        console.log(`Observability exported to: ${result.destination}`);
      }
    } else {
      const out = await observer.flush();
      console.log(`Observability written to: ${out}`);
    }
  }
}

// Parse command line args
const args = process.argv.slice(2);
const useGcs = args.includes('--gcs');
const queryArgs = args.filter((a) => a !== '--gcs');
const argQuery = queryArgs.length > 0 ? queryArgs[0] : undefined;

main(argQuery, useGcs).catch(console.error);

