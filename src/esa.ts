import EsaClient, {
  ListSitesRequest,
  ListRecordsRequest,
  CreateRecordRequest,
  CreateRecordRequestData,
} from '@alicloud/esa20240910';
import { Config } from '@alicloud/openapi-client';
import { RuntimeOptions } from '@alicloud/tea-util';
import type { EsaConfig } from './config';
import type { PlannedRecord } from './mapping';

/** An existing ESA record reduced to the fields we compare against. */
export interface EsaExistingRecord {
  recordId: number;
  recordName: string;
  recordType: string;
}

const PAGE_SIZE = 500;

export class Esa {
  private readonly client: EsaClient;
  private readonly runtime = new RuntimeOptions({});

  constructor(cfg: EsaConfig) {
    const config = new Config({
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      regionId: cfg.regionId,
      endpoint: cfg.endpoint,
    });
    this.client = new EsaClient(config);
  }

  /** Resolve a siteId by exact site name via ListSites. */
  async resolveSiteId(siteName: string): Promise<number> {
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
    return match.siteId;
  }

  /** List every record under a site, following pagination. */
  async listRecords(siteId: number): Promise<EsaExistingRecord[]> {
    const all: EsaExistingRecord[] = [];
    let pageNumber = 1;

    for (;;) {
      const req = new ListRecordsRequest({ siteId, pageNumber, pageSize: PAGE_SIZE });
      const resp = await this.client.listRecordsWithOptions(req, this.runtime);
      const records = resp.body?.records ?? [];
      for (const r of records) {
        all.push({
          recordId: Number(r.recordId ?? 0),
          recordName: r.recordName ?? '',
          recordType: r.recordType ?? '',
        });
      }

      const total = resp.body?.totalCount ?? all.length;
      if (records.length === 0 || all.length >= total) break;
      pageNumber += 1;
    }

    return all;
  }

  /** Create a single record. Returns the new recordId. */
  async createRecord(siteId: number, plan: PlannedRecord): Promise<number> {
    const req = new CreateRecordRequest({
      siteId,
      recordName: plan.recordName,
      type: plan.type,
      ttl: plan.ttl,
      proxied: plan.proxied,
      data: new CreateRecordRequestData({
        value: plan.data.value,
        priority: plan.data.priority,
      }),
      ...(plan.sourceType ? { sourceType: plan.sourceType } : {}),
      ...(plan.bizName ? { bizName: plan.bizName } : {}),
    });
    const resp = await this.client.createRecordWithOptions(req, this.runtime);
    return Number(resp.body?.recordId ?? 0);
  }
}
