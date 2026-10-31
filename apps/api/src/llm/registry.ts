import type { ProviderName } from '@copilot/shared';
import type { Config } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { FakeProvider } from './fake.js';
import { demoScript } from './fakeScripts.js';
import { NebiusProvider } from './openaiCompatible.js';
import type { LLMProvider } from './provider.js';

export class ProviderNotConfiguredError extends Error {}

/** The only place that knows concrete provider classes. Everything else depends on LLMProvider. */
/**
 * @param userKey Key the user typed in the UI for this request. It wins over the server key so a
 *   demo can run on a temporary key, and it lives only as long as the provider object.
 */
export function createProvider(name: ProviderName, config: Config, userKey?: string): LLMProvider {
  switch (name) {
    case 'anthropic': {
      const key = userKey ?? config.ANTHROPIC_API_KEY;
      if (!key) throw new ProviderNotConfiguredError('no Anthropic API key. Set ANTHROPIC_API_KEY or enter a key in the app');
      return new AnthropicProvider(config.ANTHROPIC_MODEL, key, config.ANTHROPIC_EFFORT, config.LLM_TIMEOUT_MS);
    }
    case 'nebius': {
      const key = userKey ?? config.NEBIUS_API_KEY;
      if (!key) throw new ProviderNotConfiguredError('no Nebius API key. Set NEBIUS_API_KEY or enter a key in the app');
      return new NebiusProvider(config.NEBIUS_MODEL, key, config.NEBIUS_BASE_URL, config.LLM_TIMEOUT_MS);
    }
    case 'fake':
      // Never let a scripted provider answer real users by accident.
      if (config.NODE_ENV === 'production') throw new ProviderNotConfiguredError('fake provider is disabled in production');
      return new FakeProvider(demoScript(), 'fake', 'turn');
  }
}

export function providerModel(name: ProviderName, config: Config): string {
  return name === 'anthropic' ? config.ANTHROPIC_MODEL : name === 'nebius' ? config.NEBIUS_MODEL : 'fake';
}
