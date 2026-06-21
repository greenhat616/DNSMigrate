import 'dotenv/config';

export interface DnsPodConfig {
  secretId: string;
  secretKey: string;
  domain: string;
}

export interface EsaConfig {
  accessKeyId: string;
  accessKeySecret: string;
  regionId: string;
  endpoint: string;
  /** Explicit site id from .env; when undefined it is resolved via ListSites. */
  siteId?: number;
  /** Site name used to resolve siteId; defaults to the DNSPod domain. */
  siteName: string;
}

export interface AppConfig {
  dnspod: DnsPodConfig;
  esa: EsaConfig;
  /** Whether A/AAAA/CNAME records should be proxied through ESA's edge. */
  proxied: boolean;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value.trim();
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/** Load and validate configuration from the environment (.env). */
export function loadConfig(): AppConfig {
  const domain = required('DNSPOD_DOMAIN');
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
    dnspod: {
      secretId: required('DNSPOD_SECRET_ID'),
      secretKey: required('DNSPOD_SECRET_KEY'),
      domain,
    },
    esa: {
      accessKeyId: required('ALIBABA_CLOUD_ACCESS_KEY_ID'),
      accessKeySecret: required('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
      regionId,
      endpoint: optional('ESA_ENDPOINT', `esa.${regionId}.aliyuncs.com`),
      siteId,
      siteName: optional('ESA_SITE_NAME', domain),
    },
    proxied: optional('ESA_PROXIED', 'false').toLowerCase() === 'true',
  };
}
