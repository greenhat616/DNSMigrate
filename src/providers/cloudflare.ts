import Cloudflare from 'cloudflare';
import { optional, optionalBool, required } from '../config';
import { stripTrailingDot, toFqdn, toHost, type MirRecord } from '../mir';
import type { Provider, ProviderContext } from './types';

/** Types this tool reads/writes against Cloudflare. */
const SUPPORTED = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'CAA', 'SRV']);
/** MIR types Cloudflare can proxy (orange-cloud). */
const PROXYABLE = new Set(['A', 'AAAA', 'CNAME']);

interface CloudflareConfig {
  apiToken: string;
  /** Explicit zone id; when undefined it is resolved from the zone name. */
  zoneId?: string;
  /** Whether proxyable records are imported as proxied. */
  proxied: boolean;
}

function loadConfig(): CloudflareConfig {
  return {
    apiToken: required('CLOUDFLARE_API_TOKEN'),
    zoneId: optional('CLOUDFLARE_ZONE_ID') || undefined,
    proxied: optionalBool('CLOUDFLARE_PROXIED', false),
  };
}

class CloudflareProvider implements Provider {
  readonly id = 'cloudflare';
  readonly capabilities = { supportedTypes: SUPPORTED, proxy: true };

  private readonly client: Cloudflare;
  private readonly cfg: CloudflareConfig;
  private cachedZoneId?: string;

  constructor(cfg: CloudflareConfig) {
    this.cfg = cfg;
    this.client = new Cloudflare({ apiToken: cfg.apiToken });
  }

  /** Resolve and cache the zone id (explicit or by exact name match). */
  private async resolveZoneId(ctx: ProviderContext): Promise<string> {
    if (this.cfg.zoneId) return this.cfg.zoneId;
    if (this.cachedZoneId) return this.cachedZoneId;

    const zoneName = stripTrailingDot(ctx.zone).toLowerCase();
    const found: string[] = [];
    for await (const zone of this.client.zones.list({ name: zoneName })) {
      found.push(zone.name);
      if (zone.name.toLowerCase() === zoneName) {
        this.cachedZoneId = zone.id;
        return zone.id;
      }
    }
    const names = found.join(', ') || '(none)';
    throw new Error(
      `Could not resolve Cloudflare zone id for "${ctx.zone}". Zones found: ${names}. ` +
        `Set CLOUDFLARE_ZONE_ID in .env to override.`,
    );
  }

  async listRecords(ctx: ProviderContext): Promise<MirRecord[]> {
    const zoneId = await this.resolveZoneId(ctx);
    const all: MirRecord[] = [];

    for await (const r of this.client.dns.records.list({ zone_id: zoneId })) {
      const type = (r.type ?? '').toUpperCase();
      all.push({
        host: toHost(r.name ?? '', ctx.zone),
        type,
        value: (r.content as string) ?? '',
        ttl: Number(r.ttl ?? 1),
        priority: 'priority' in r && r.priority != null ? Number(r.priority) : undefined,
        proxied: r.proxied ?? false,
      });
    }

    return all;
  }

  async createRecord(ctx: ProviderContext, rec: MirRecord): Promise<string> {
    const zoneId = await this.resolveZoneId(ctx);
    const type = rec.type.toUpperCase();
    const proxied = this.cfg.proxied && PROXYABLE.has(type);

    const content = type === 'CNAME' || type === 'MX' || type === 'NS'
      ? stripTrailingDot(rec.value)
      : rec.value;

    const params = {
      zone_id: zoneId,
      type,
      name: toFqdn(rec.host, ctx.zone),
      content,
      // Cloudflare forces TTL 1 (automatic) for proxied records.
      ttl: proxied ? 1 : rec.ttl > 1 ? rec.ttl : 1,
      ...(PROXYABLE.has(type) ? { proxied } : {}),
      ...(type === 'MX' && rec.priority != null ? { priority: rec.priority } : {}),
    };

    const resp = await this.client.dns.records.create(
      params as Cloudflare.DNS.RecordCreateParams,
    );
    return String(resp.id ?? '');
  }
}

export function createCloudflareProvider(): Provider {
  return new CloudflareProvider(loadConfig());
}
