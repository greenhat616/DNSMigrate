import * as tencentcloud from 'tencentcloud-sdk-nodejs-dnspod';
import type { DnsPodConfig } from './config';

const DnsPodClient = tencentcloud.dnspod.v20210323.Client;

/** A DNS record as returned by DNSPod, normalized to the fields we use. */
export interface DnsPodRecord {
  recordId: number;
  /** Subdomain part, e.g. "www" or "@" for the apex. */
  name: string;
  type: string;
  value: string;
  line: string;
  ttl: number;
  /** MX priority (only meaningful for MX records). */
  mx: number;
  status: string;
}

const PAGE_SIZE = 3000; // DNSPod max Limit per request

export class DnsPod {
  private readonly client: InstanceType<typeof DnsPodClient>;

  constructor(cfg: DnsPodConfig) {
    this.client = new DnsPodClient({
      credential: { secretId: cfg.secretId, secretKey: cfg.secretKey },
      region: '',
      profile: { httpProfile: { endpoint: 'dnspod.tencentcloudapi.com' } },
    });
  }

  /** List every record for a domain, following pagination. */
  async listRecords(domain: string): Promise<DnsPodRecord[]> {
    const all: DnsPodRecord[] = [];
    let offset = 0;

    for (;;) {
      let resp;
      try {
        resp = await this.client.DescribeRecordList({
          Domain: domain,
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
        all.push({
          recordId: Number(r.RecordId ?? 0),
          name: r.Name ?? '@',
          type: r.Type ?? '',
          value: r.Value ?? '',
          line: r.Line ?? '',
          ttl: Number(r.TTL ?? 600),
          mx: Number(r.MX ?? 0),
          status: r.Status ?? '',
        });
      }

      const total = resp.RecordCountInfo?.TotalCount ?? all.length;
      offset += list.length;
      if (list.length === 0 || offset >= total) break;
    }

    return all;
  }
}
