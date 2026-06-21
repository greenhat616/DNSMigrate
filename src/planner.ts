import type { MirRecord } from './mir';
import type { ProviderCapabilities, ProviderContext } from './providers/types';

export type PlanResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Decide whether a source MIR record should be migrated to a target with the
 * given capabilities. This is provider-neutral: anything type- or proxy-
 * specific lives in the provider's createRecord. Here we only drop records that
 * cannot or should not cross over regardless of provider.
 */
export function planRecord(
  rec: MirRecord,
  capabilities: ProviderCapabilities,
  _ctx: ProviderContext,
): PlanResult {
  const type = rec.type.toUpperCase();

  if (rec.disabled) {
    return { ok: false, reason: 'record is disabled at the source' };
  }
  if (type === 'SOA') {
    return { ok: false, reason: 'SOA records are managed by the DNS provider' };
  }
  if (type === 'NS' && (rec.host === '@' || rec.host === '')) {
    return { ok: false, reason: 'apex NS records are managed by the target provider' };
  }
  if (!capabilities.supportedTypes.has(type)) {
    return { ok: false, reason: `target does not support "${rec.type}" records` };
  }

  return { ok: true };
}
