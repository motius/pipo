import type { pipoConfig } from '../config/types.ts';
import { discoverAmbientGitHubToken, GITHUB_MODELS_BASE_URL } from './github-models.ts';
import { getSetting, setSetting } from '../vault/settings.ts';
import { setSecret, hasSecret } from '../vault/keychain.ts';

const SETTING_PROVIDERS = 'llm.providers';
const SETTING_DEFAULT = 'llm.default';

/**
 * Ensures that if no LLM provider has an active key, or if an ambient
 * GitHub token is discovered, a zero-cost 'github' provider is initialized.
 */
export async function ensureFreeGitHubModels(config: pipoConfig): Promise<void> {
  const token = discoverAmbientGitHubToken();
  if (!token) return;

  const currentProviders = getSetting<Record<string, any>>(SETTING_PROVIDERS) || config.llm.providers || {};
  const currentDefault = getSetting<string>(SETTING_DEFAULT) || config.llm.default;

  // If github provider already has a key in keychain or config, we're good
  if (hasSecret('llm.provider.github.api_key') && currentProviders['github']) {
    return;
  }

  // If no providers exist at all or user has no default configured, register free GitHub models
  const hasConfiguredProviders = Object.keys(currentProviders).some(
    (name) => hasSecret(`llm.provider.${name}.api_key`) || Boolean(currentProviders[name]?.api_key)
  );

  if (!hasConfiguredProviders || !currentProviders['github']) {
    const updated = {
      ...currentProviders,
      github: {
        kind: 'github',
        base_url: GITHUB_MODELS_BASE_URL,
      },
    };

    setSecret('llm.provider.github.api_key', token);
    setSetting(SETTING_PROVIDERS, updated);

    if (!currentDefault || currentDefault.startsWith('pipo:')) {
      setSetting(SETTING_DEFAULT, 'github:gpt-4o-mini');
      setSetting('llm.tiers.conversation', 'github:gpt-4o-mini');
      setSetting('llm.tiers.high', 'github:gpt-4o');
      setSetting('llm.tiers.medium', 'github:gpt-4o-mini');
      setSetting('llm.tiers.low', 'github:gpt-4o-mini');
    }

    console.log('[LLM] Auto-configured free GitHub Models (zero-cost agent reroute active: gpt-4o-mini & gpt-4o)');
  }
}
