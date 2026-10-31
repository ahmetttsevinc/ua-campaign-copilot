import type { ProviderName } from '@copilot/shared';

/**
 * User-supplied provider keys for demos without server keys. sessionStorage: the key survives a
 * reload but disappears when the tab closes, and is never sent anywhere except our own API.
 */
const storageKey = (p: ProviderName) => `ua-copilot:api-key:${p}`;

export function getApiKey(p: ProviderName): string | null {
  try {
    return sessionStorage.getItem(storageKey(p));
  } catch {
    return null;
  }
}

export function setApiKey(p: ProviderName, key: string): void {
  sessionStorage.setItem(storageKey(p), key);
}

export function clearApiKey(p: ProviderName): void {
  sessionStorage.removeItem(storageKey(p));
}
