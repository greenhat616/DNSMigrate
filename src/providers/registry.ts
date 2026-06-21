import type { Provider, ProviderFactory } from './types';
import { createDnsPodProvider } from './dnspod';
import { createEsaProvider } from './esa';
import { createCloudflareProvider } from './cloudflare';

/** Every provider id usable with --from / --to. */
export const PROVIDER_IDS = ['dnspod', 'esa', 'cloudflare'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

const FACTORIES: Record<ProviderId, ProviderFactory> = {
  dnspod: createDnsPodProvider,
  esa: createEsaProvider,
  cloudflare: createCloudflareProvider,
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Build a provider by id. This reads and validates only that provider's
 * environment, so unused providers never require credentials.
 */
export function getProvider(id: ProviderId): Provider {
  return FACTORIES[id]();
}
