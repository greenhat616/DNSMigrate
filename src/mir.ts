/**
 * MIR — Middle Intermediate Record.
 *
 * A provider-neutral DNS record. Every provider reads its native records into
 * MIR (pull) and writes MIR back into its native API (push), so any source can
 * feed any target without N×N adapters.
 */
export interface MirRecord {
  /**
   * Host part relative to the zone, e.g. "www". The apex is the literal "@".
   * Never fully-qualified and never carries a trailing dot.
   */
  host: string;
  /** Canonical, upper-cased DNS type: A, AAAA, CNAME, TXT, MX, NS, CAA, SRV, SOA, ... */
  type: string;
  /** Primary value: IP for A/AAAA, target host for CNAME/NS/MX, text for TXT. */
  value: string;
  /** TTL in seconds. 1 means "automatic" on providers that support it. */
  ttl: number;
  /** MX/SRV priority. Undefined for types that do not use it. */
  priority?: number;
  /** Source-side proxy state. Targets re-decide this from their own settings. */
  proxied?: boolean;
  /** Record is disabled/paused at the source and should not be migrated. */
  disabled?: boolean;
  /** Optional resolution line carried through (DNSPod). Informational. */
  line?: string;
}

/**
 * Types where a host may hold only ONE record (DNS singletons). For these the
 * identity ignores the value: an existing record of this type at the host is
 * "the same" regardless of where it points, because a host cannot hold a
 * second one (e.g. CNAME — it is also exclusive with A/AAAA at that host).
 */
const SINGLETON_TYPES = new Set(['CNAME']);

/**
 * Identity of a record for idempotency.
 *
 * - Singleton types (CNAME): keyed on host+type only, so an existing CNAME at
 *   the host is recognized whatever its value — avoids creating a conflicting
 *   second CNAME.
 * - Multi-value types (A/AAAA/MX/TXT/NS/SRV/CAA): keyed on host+type+value
 *   (plus priority for MX/SRV), so several distinct records can coexist and
 *   none is dropped as a false duplicate.
 *
 * Values are normalized so the same record compares equal across providers
 * (trailing dots, hostname/IP case, and the wrapping quotes some providers add
 * to TXT values).
 */
export function recordIdentity(rec: {
  host: string;
  type: string;
  value: string;
  priority?: number;
}): string {
  const host = rec.host.trim().toLowerCase();
  const type = rec.type.toUpperCase();

  if (SINGLETON_TYPES.has(type)) {
    return `${host}|${type}`;
  }

  let value = stripTrailingDot(rec.value.trim());
  if (type === 'TXT') {
    // Strip a single pair of wrapping quotes that providers may add/omit.
    value = value.replace(/^"([\s\S]*)"$/, '$1');
  } else {
    // Hostnames and IP addresses are case-insensitive.
    value = value.toLowerCase();
  }
  // priority discriminates MX/SRV records that share host+type but differ.
  const priority = rec.priority != null ? `|p${rec.priority}` : '';
  return `${host}|${type}|${value}${priority}`;
}

/** Remove a single trailing dot, if present. */
export function stripTrailingDot(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value;
}

/** A value is an IPv6 address (for recovering AAAA from a merged A/AAAA type). */
export function isIPv6(value: string): boolean {
  return value.includes(':');
}

/**
 * Turn a fully-qualified record name into a host relative to the zone.
 * "www.example.com" + "example.com" -> "www"; "example.com" -> "@".
 */
export function toHost(fqdn: string, zone: string): string {
  const name = stripTrailingDot(fqdn).toLowerCase();
  const z = stripTrailingDot(zone).toLowerCase();
  if (name === z || name === '') return '@';
  if (name.endsWith(`.${z}`)) return name.slice(0, -(z.length + 1));
  // Already a bare host (provider returned a relative name).
  return fqdn;
}

/**
 * Build a fully-qualified record name from a host and zone.
 * "@" -> "example.com"; "www" -> "www.example.com".
 */
export function toFqdn(host: string, zone: string): string {
  const h = host.trim();
  const z = stripTrailingDot(zone);
  if (h === '' || h === '@') return z;
  if (h.toLowerCase().endsWith(`.${z.toLowerCase()}`) || h.toLowerCase() === z.toLowerCase()) {
    return stripTrailingDot(h);
  }
  return `${h}.${z}`;
}
