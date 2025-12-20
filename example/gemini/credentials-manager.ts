/**
 * Credentials Manager for Google Cloud / Vertex AI authentication.
 * 
 * Supports:
 * - Service account JSON file (via GOOGLE_APPLICATION_CREDENTIALS or explicit path)
 * - Application Default Credentials (gcloud auth application-default login)
 */

import * as fs from 'fs';
import { VertexAI } from '@google-cloud/vertexai';
import { wrapGeminiClient, observer } from '../../src/index.js';

export interface CredentialsManagerOptions {
  /** Path to service account JSON file */
  credentialsPath?: string;
  /** GCP project ID (overrides env/credentials) */
  project?: string;
  /** GCP region (default: us-central1) */
  location?: string;
}

export class CredentialsManager {
  private credentialsPath: string | null;
  private projectId: string | null = null;
  private location: string;

  constructor(options: CredentialsManagerOptions = {}) {
    this.credentialsPath = options.credentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null;
    this.location = options.location ?? process.env.GOOGLE_CLOUD_REGION ?? 'us-central1';
    
    if (options.project) {
      this.projectId = options.project;
    }
    
    this.setupCredentials();
  }

  /**
   * Setup GCP credentials using service account JSON or default credentials.
   */
  private setupCredentials(): void {
    // Try service account file first
    if (this.credentialsPath && fs.existsSync(this.credentialsPath)) {
      try {
        const credsContent = fs.readFileSync(this.credentialsPath, 'utf-8');
        const credsInfo = JSON.parse(credsContent) as {
          project_id?: string;
          client_email?: string;
        };
        
        if (!this.projectId) {
          this.projectId = credsInfo.project_id ?? null;
        }

        // Set env var for Google client libraries
        process.env.GOOGLE_APPLICATION_CREDENTIALS = this.credentialsPath;

        console.log('✅ Service account authentication successful');
        console.log(`✅ Project ID: ${this.projectId}`);
        console.log(`✅ Service account: ${credsInfo.client_email ?? 'N/A'}`);
        console.log(`✅ Location: ${this.location}`);
      } catch (e) {
        throw new Error(`Failed to load service account from ${this.credentialsPath}: ${e}`);
      }
    } else {
      // Use Application Default Credentials (ADC)
      // This works when user has run: gcloud auth application-default login
      this.projectId = this.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null;

      if (!this.projectId) {
        throw new Error(
          'No project ID found. Either:\n' +
          '  1. Set GOOGLE_CLOUD_PROJECT environment variable\n' +
          '  2. Provide a service account JSON file\n' +
          '  3. Run: gcloud config set project YOUR_PROJECT_ID'
        );
      }

      console.log(`✅ Using Application Default Credentials for project: ${this.projectId}`);
      console.log(`✅ Location: ${this.location}`);
      console.log('   (Ensure you have run: gcloud auth application-default login)');
    }
  }

  /**
   * Get authenticated Vertex AI client wrapped with observability.
   */
  getClient(): VertexAI {
    if (!this.projectId) {
      throw new Error('Project ID is required');
    }

    const client = new VertexAI({
      project: this.projectId,
      location: this.location,
    });
    
    // Wrap the client with observability
    return wrapGeminiClient(client, observer);
  }

  /**
   * Get project ID.
   */
  getProjectId(): string | null {
    return this.projectId;
  }

  /**
   * Get location.
   */
  getLocation(): string {
    return this.location;
  }
}

