import 'dotenv/config';

/** Read a required env var, trimming whitespace. Throws when missing/empty. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value.trim();
}

/** Read an optional env var, falling back to a default. */
export function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/** Read an optional boolean env var ("true"/"false", case-insensitive). */
export function optionalBool(name: string, fallback = false): boolean {
  const value = optional(name);
  if (value === '') return fallback;
  return value.toLowerCase() === 'true';
}

/**
 * The DNS zone operated on for both source and target, e.g. "example.com".
 * Prefers DOMAIN; falls back to the legacy DNSPOD_DOMAIN for compatibility.
 */
export function loadDomain(): string {
  const value = optional('DOMAIN') || optional('DNSPOD_DOMAIN');
  if (!value) {
    throw new Error('Missing required environment variable: DOMAIN (see .env.example)');
  }
  return value;
}
