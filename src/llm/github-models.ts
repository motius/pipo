/**
 * GitHub Models Provider (Free Zero-Expense AI for Agents)
 *
 * Reroutes agent LLM requests to GitHub's free model inference service
 * (https://models.inference.ai.azure.com) using a GitHub Personal Access Token
 * or ambient GITHUB_TOKEN / gh CLI credentials.
 *
 * Provides completely free access to:
 * - gpt-4o-mini
 * - gpt-4o
 * - Meta-Llama-3.3-70B-Instruct
 * - Meta-Llama-3.1-8B-Instruct
 * - Mistral-large
 * - Mistral-small
 * - Phi-3.5-mini-instruct
 * - DeepSeek-R1
 */

import { OpenAICompatibleProvider } from './openai-compatible.ts';
import type { LLMResponse, LLMMessage, LLMOptions, LLMStreamEvent } from './provider.ts';

export const GITHUB_MODELS_BASE_URL = 'https://models.inference.ai.azure.com';

export const DEFAULT_FREE_GITHUB_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'Meta-Llama-3.3-70B-Instruct',
  'Meta-Llama-3.1-8B-Instruct',
  'Mistral-large',
  'Mistral-small',
  'Phi-3.5-mini-instruct',
  'DeepSeek-R1',
];

/**
 * Automatically discovers a GitHub token from the local environment:
 * 1. process.env.GITHUB_TOKEN / process.env.GH_TOKEN
 * 2. `gh auth token` CLI tool
 * 3. Git Credential Manager (GCM)
 */
export function discoverAmbientGitHubToken(): string | null {
  // 1. Direct environment variable
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken && envToken.trim()) {
    return envToken.trim();
  }

  // 2. Try GitHub CLI (gh auth token)
  try {
    const proc = Bun.spawnSync(['gh', 'auth', 'token']);
    if (proc.exitCode === 0) {
      const token = new TextDecoder().decode(proc.stdout).trim();
      if (token) return token;
    }
  } catch {}

  // 3. Try Git Credential Manager
  try {
    const input = 'protocol=https\nhost=github.com\n\n';
    const proc = Bun.spawnSync(['git', 'credential', 'fill'], {
      stdin: new TextEncoder().encode(input),
    });
    if (proc.exitCode === 0) {
      const output = new TextDecoder().decode(proc.stdout);
      for (const line of output.split('\n')) {
        if (line.startsWith('password=')) {
          const pass = line.substring(9).trim();
          if (pass.startsWith('gho_') || pass.startsWith('ghp_') || pass.length > 20) {
            return pass;
          }
        }
      }
    }
  } catch {}

  return null;
}

export class GitHubModelsProvider extends OpenAICompatibleProvider {
  override name = 'github';
  override readonly placeholderDefaultModel = false;

  constructor(apiKey: string, baseUrl?: string, defaultModel = 'gpt-4o-mini') {
    const resolvedUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : GITHUB_MODELS_BASE_URL;
    super(resolvedUrl, defaultModel, apiKey, 'Authorization');
  }

  protected override get errorLabel(): string {
    return 'GitHub Models (Free Tier)';
  }

  override async listModels(): Promise<string[]> {
    try {
      const fetched = await super.listModels();
      if (fetched && fetched.length > 0) return fetched;
    } catch {
      // Fallback to verified catalog when offline or permission restricted
    }
    return DEFAULT_FREE_GITHUB_MODELS;
  }
}
