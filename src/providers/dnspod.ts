import * as tencentcloud from 'tencentcloud-sdk-nodejs-dnspod';
import { required } from '../config';
import { stripTrailingDot, type MirRecord } from '../mir';
import type { Provider, ProviderContext } from './types';

const DnsPodClient = tencentcloud.dnspod.v20210323.Client;

const PAGE_SIZE = 3000; // DNSPod max Limit per request.
const DEFAULT_LINE = '默认'; // DNSPod's default resolution line (domestic accounts).

/** Types DNSPod can read and write. */
const SUPPORTED = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'CAA', 'SRV']);

interface DnsPodConfig {
  secretId: string;
  secretKey: string;
}

function loadConfig(): DnsPodConfig {
  return {
    secretId: required('DNSPOD_SECRET_ID'),
    secretKey: required('DNSPOD_SECRET_KEY'),
  };
}

class DnsPodProvider implements Provider {
  readonly id = 'dnspod';
  readonly capabilities = { supportedTypes: SUPPORTED, proxy: false };

  private readonly client: InstanceType<typeof DnsPodClient>;

  constructor(cfg: DnsPodConfig) {
    this.client = new DnsPodClient({
      credential: { secretId: cfg.secretId, secretKey: cfg.secretKey },
      region: '',
      profile: { httpProfile: { endpoint: 'dnspod.tencentcloudapi.com' } },
    });
  }

  async listRecords(ctx: ProviderContext): Promise<MirRecord[]> {
    const all: MirRecord[] = [];
    let offset = 0;

    for (;;) {
      let resp;
      try {
        resp = await this.client.DescribeRecordList({
          Domain: ctx.zone,
          Offset: offset,
          Limit: PAGE_SIZE,
        });
      } catch (err) {
        // DNSPod throws this code when the domain has no records at all.
        if (err instanceof Error && /ResourceNotFound\.NoDataOfRecord/.test(err.message)) {
          break;
        }
        throw err;
      }

      const list = resp.RecordList ?? [];
      for (const r of list) {
        const status = (r.Status ?? '').toUpperCase();
        const type = (r.Type ?? '').toUpperCase();
        all.push({
          host: r.Name && r.Name !== '' ? r.Name : '@',
          type,
          value: r.Value ?? '',
          ttl: Number(r.TTL ?? 600),
          // DNSPod returns MX=0 for non-MX records; only carry it for MX.
          priority: type === 'MX' ? Number(r.MX ?? 0) : undefined,
          disabled: status === 'DISABLE' || status === 'DISABLED',
          line: r.Line ?? undefined,
        });
      }

      const total = resp.RecordCountInfo?.TotalCount ?? all.length;
      offset += list.length;
      if (list.length === 0 || offset >= total) break;
    }

    return all;
  }

  async createRecord(ctx: ProviderContext, rec: MirRecord): Promise<string> {
    const type = rec.type.toUpperCase();
    const value = type === 'CNAME' || type === 'MX' || type === 'NS'
      ? stripTrailingDot(rec.value)
      : rec.value;

    const resp = await this.client.CreateRecord({
      Domain: ctx.zone,
      SubDomain: rec.host === '@' ? '@' : rec.host,
      RecordType: type,
      RecordLine: rec.line || DEFAULT_LINE,
      Value: value,
      // DNSPod requires MX for MX records; omit otherwise.
      ...(type === 'MX' && rec.priority != null ? { MX: rec.priority } : {}),
      // TTL 1 is ESA/CF's "automatic"; DNSPod's floor is 1s but practical min is higher.
      TTL: rec.ttl > 1 ? rec.ttl : 600,
    });

    return String(resp.RecordId ?? 0);
  }
}

export function createDnsPodProvider(): Provider {
  return new DnsPodProvider(loadConfig());
}
