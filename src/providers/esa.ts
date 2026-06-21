import EsaClient, {
  ListSitesRequest,
  ListRecordsRequest,
  CreateRecordRequest,
  CreateRecordRequestData,
} from '@alicloud/esa20240910';
import { Config } from '@alicloud/openapi-client';
import { RuntimeOptions } from '@alicloud/tea-util';
import { optional, optionalBool, required } from '../config';
import { isIPv6, stripTrailingDot, toFqdn, toHost, type MirRecord } from '../mir';
import type { Provider, ProviderContext } from './types';

const PAGE_SIZE = 500;

/** Types ESA can read and write (A/AAAA is one merged ESA type). */
const SUPPORTED = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'CAA', 'SRV']);
/** MIR types that ESA can proxy through its edge. */
const PROXYABLE = new Set(['A', 'AAAA', 'CNAME']);

interface EsaConfig {
  accessKeyId: string;
  accessKeySecret: string;
  regionId: string;
  endpoint: string;
  /** Explicit site id; when undefined it is resolved from the zone via ListSites. */
  siteId?: number;
  /** Site name used to resolve siteId; defaults to the zone/domain. */
  siteName?: string;
  /** Whether proxyable records are imported as proxied through ESA's edge. */
  proxied: boolean;
}

function loadConfig(): EsaConfig {
  const regionId = optional('ESA_REGION_ID', 'cn-hangzhou');
  const siteIdRaw = optional('ESA_SITE_ID');
  let siteId: number | undefined;
  if (siteIdRaw) {
    siteId = Number(siteIdRaw);
    if (!Number.isInteger(siteId) || siteId <= 0) {
      throw new Error(`ESA_SITE_ID must be a positive integer, got "${siteIdRaw}"`);
    }
  }
  return {
    accessKeyId: required('ALIBABA_CLOUD_ACCESS_KEY_ID'),
    accessKeySecret: required('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
    regionId,
    endpoint: optional('ESA_ENDPOINT', `esa.${regionId}.aliyuncs.com`),
    siteId,
    siteName: optional('ESA_SITE_NAME') || undefined,
    proxied: optionalBool('ESA_PROXIED', false),
  };
}

/** Map a MIR type onto ESA's record type. ESA merges A and AAAA. */
function esaType(type: string): string {
  return type === 'A' || type === 'AAAA' ? 'A/AAAA' : type;
}

class EsaProvider implements Provider {
  readonly id = 'esa';
  readonly capabilities = { supportedTypes: SUPPORTED, proxy: true };

  private readonly client: EsaClient;
  private readonly runtime = new RuntimeOptions({});
  private readonly cfg: EsaConfig;
  private cachedSiteId?: number;

  constructor(cfg: EsaConfig) {
    this.cfg = cfg;
    this.client = new EsaClient(
      new Config({
        accessKeyId: cfg.accessKeyId,
        accessKeySecret: cfg.accessKeySecret,
        regionId: cfg.regionId,
        endpoint: cfg.endpoint,
      }),
    );
  }

  /** Resolve and cache the siteId for the zone (explicit or via ListSites). */
  private async resolveSiteId(ctx: ProviderContext): Promise<number> {
    if (this.cfg.siteId) return this.cfg.siteId;
    if (this.cachedSiteId) return this.cachedSiteId;

    const siteName = this.cfg.siteName ?? ctx.zone;
    const req = new ListSitesRequest({ siteName, pageNumber: 1, pageSize: PAGE_SIZE });
    const resp = await this.client.listSitesWithOptions(req, this.runtime);
    const sites = resp.body?.sites ?? [];
    const match = sites.find((s) => s.siteName === siteName);
    if (!match?.siteId) {
      const names = sites.map((s) => s.siteName).filter(Boolean).join(', ') || '(none)';
      throw new Error(
        `Could not resolve ESA siteId for "${siteName}". Sites found: ${names}. ` +
          `Set ESA_SITE_ID in .env to override.`,
      );
    }
    this.cachedSiteId = match.siteId;
    return match.siteId;
  }

  async listRecords(ctx: ProviderContext): Promise<MirRecord[]> {
    const siteId = await this.resolveSiteId(ctx);
    const all: MirRecord[] = [];
    let pageNumber = 1;

    for (;;) {
      const req = new ListRecordsRequest({ siteId, pageNumber, pageSize: PAGE_SIZE });
      const resp = await this.client.listRecordsWithOptions(req, this.runtime);
      const records = resp.body?.records ?? [];
      for (const r of records) {
        const value = r.data?.value ?? '';
        const rawType = (r.recordType ?? '').toUpperCase();
        // ESA reports both A and AAAA as "A/AAAA"; recover the real type from the value.
        const type = rawType === 'A/AAAA' ? (isIPv6(value) ? 'AAAA' : 'A') : rawType;
        all.push({
          host: toHost(r.recordName ?? '', ctx.zone),
          type,
          value,
          ttl: Number(r.ttl ?? 1),
          priority: r.data?.priority != null ? Number(r.data.priority) : undefined,
          proxied: r.proxied ?? false,
        });
      }

      const total = resp.body?.totalCount ?? all.length;
      if (records.length === 0 || all.length >= total) break;
      pageNumber += 1;
    }

    return all;
  }

  async createRecord(ctx: ProviderContext, rec: MirRecord): Promise<string> {
    const siteId = await this.resolveSiteId(ctx);
    const type = rec.type.toUpperCase();
    const proxied = this.cfg.proxied && PROXYABLE.has(type);

    const value = type === 'CNAME' || type === 'MX' || type === 'NS'
      ? stripTrailingDot(rec.value)
      : rec.value;

    const req = new CreateRecordRequest({
      siteId,
      recordName: toFqdn(rec.host, ctx.zone),
      type: esaType(type),
      // ESA determines TTL automatically (value 1) when a record is proxied.
      ttl: proxied ? 1 : rec.ttl > 1 ? rec.ttl : 600,
      proxied,
      data: new CreateRecordRequestData({ value, priority: rec.priority }),
      ...(type === 'CNAME' ? { sourceType: 'Domain' } : {}),
      ...(proxied ? { bizName: 'web' } : {}),
    });
    const resp = await this.client.createRecordWithOptions(req, this.runtime);
    return String(resp.body?.recordId ?? 0);
  }
}

export function createEsaProvider(): Provider {
  return new EsaProvider(loadConfig());
}
