import type { MirRecord } from '../mir';

/** Per-operation context shared by source and target providers. */
export interface ProviderContext {
  /** The DNS zone / domain being operated on, e.g. "example.com". */
  zone: string;
}

/** What a provider can read and write. Used by the planner to filter records. */
export interface ProviderCapabilities {
  /** Canonical upper-cased types this provider can emit/accept (A, CNAME, ...). */
  supportedTypes: ReadonlySet<string>;
  /** Whether the provider supports proxied (CDN/edge) records at all. */
  proxy: boolean;
}

/**
 * A DNS provider. Any provider can act as a source (listRecords → MIR) or a
 * target (createRecord from MIR), enabling --from <any> --to <any>.
 */
export interface Provider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  /** Pull every record for the zone, normalized to MIR. */
  listRecords(ctx: ProviderContext): Promise<MirRecord[]>;

  /** Create one record from MIR at the target. Returns the new record id. */
  createRecord(ctx: ProviderContext, record: MirRecord): Promise<string>;
}

/** Builds a provider, reading and validating its own slice of the environment. */
export type ProviderFactory = () => Provider;
