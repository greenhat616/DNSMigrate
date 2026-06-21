import type { DnsPodRecord } from './dnspod';

/** A DNSPod record translated into ESA CreateRecord parameters. */
export interface PlannedRecord {
  /** Full record name in ESA, e.g. "www.example.com" or the apex domain. */
  recordName: string;
  /** ESA record type. Note ESA uses "A/AAAA" for both A and AAAA. */
  type: string;
  proxied: boolean;
  ttl: number;
  sourceType?: string;
  bizName?: string;
  data: { value: string; priority?: number };
  /** The originating DNSPod record, kept for logging. */
  source: DnsPodRecord;
}

export type MapResult =
  | { ok: true; plan: PlannedRecord }
  | { ok: false; reason: string };

/** Record types we translate. Anything else is skipped with a warning. */
const SUPPORTED = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS']);
const PROXYABLE = new Set(['A/AAAA', 'CNAME']);

function stripTrailingDot(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value;
}

function buildRecordName(name: string, domain: string): string {
  const sub = name.trim();
  if (sub === '' || sub === '@') return domain;
  return `${sub}.${domain}`;
}

/** Map ESA's record type from a DNSPod type. ESA merges A and AAAA. */
function esaType(dnspodType: string): string {
  const t = dnspodType.toUpperCase();
  if (t === 'A' || t === 'AAAA') return 'A/AAAA';
  return t;
}

/**
 * Translate a single DNSPod record into an ESA CreateRecord plan, or explain
 * why it cannot/should not be imported.
 */
export function mapRecord(
  rec: DnsPodRecord,
  domain: string,
  proxiedDefault: boolean,
): MapResult {
  const type = rec.type.toUpperCase();

  if (type === 'SOA') {
    return { ok: false, reason: 'SOA records are managed by the DNS provider' };
  }
  if (type === 'NS' && (rec.name === '@' || rec.name === '')) {
    return { ok: false, reason: 'apex NS records are managed by ESA' };
  }
  if (rec.status.toUpperCase() === 'DISABLE' || rec.status.toUpperCase() === 'DISABLED') {
    return { ok: false, reason: 'record is disabled in DNSPod' };
  }
  if (!SUPPORTED.has(type)) {
    return { ok: false, reason: `unsupported record type "${rec.type}"` };
  }

  const mappedType = esaType(type);
  const proxied = proxiedDefault && PROXYABLE.has(mappedType);

  const data: PlannedRecord['data'] = { value: rec.value };
  if (type === 'CNAME' || type === 'MX' || type === 'NS') {
    data.value = stripTrailingDot(rec.value);
  }
  if (type === 'MX') {
    data.priority = rec.mx;
  }

  const plan: PlannedRecord = {
    recordName: buildRecordName(rec.name, domain),
    type: mappedType,
    proxied,
    // ESA determines TTL automatically (value 1) when a record is proxied.
    ttl: proxied ? 1 : rec.ttl,
    data,
    source: rec,
  };

  if (type === 'CNAME') {
    plan.sourceType = 'Domain';
  }
  if (proxied) {
    plan.bizName = 'web';
  }

  return { ok: true, plan };
}

/** Stable key for de-duplicating a record by name + ESA type. */
export function recordKey(recordName: string, type: string): string {
  return `${recordName.toLowerCase()}|${type.toUpperCase()}`;
}
