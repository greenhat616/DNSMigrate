#!/usr/bin/env node
import { loadDomain } from './config';
import { recordIdentity, type MirRecord } from './mir';
import { planRecord } from './planner';
import { getProvider, isProviderId, PROVIDER_IDS, type ProviderId } from './providers/registry';
import type { Provider, ProviderContext } from './providers/types';
import { logger } from './logger';

interface CliOptions {
  from?: string;
  to?: string;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--from':
        opts.from = argv[++i];
        break;
      case '--to':
        opts.to = argv[++i];
        break;
      case '--dry-run':
      case '-n':
        opts.dryRun = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        if (arg.startsWith('--from=')) opts.from = arg.slice('--from='.length);
        else if (arg.startsWith('--to=')) opts.to = arg.slice('--to='.length);
        else logger.warn(`Unknown argument ignored: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
dns-migrate — copy DNS records between providers via a neutral intermediate model

Usage:
  dns-migrate --from <provider> --to <provider> [--dry-run]
  pnpm dev --from esa --to cloudflare --dry-run

Providers:
  ${PROVIDER_IDS.join(', ')}

Options:
  --from <provider>   Source provider to read records from
  --to <provider>     Target provider to create records in
  -n, --dry-run       Show what would be created without writing to the target
  -h, --help          Show this help

Configuration (credentials, zone) is read from .env (see .env.example).
Only the providers referenced by --from/--to are validated.
`);
}

function describe(rec: MirRecord): string {
  const extras: string[] = [];
  if (rec.priority !== undefined) extras.push(`prio=${rec.priority}`);
  if (rec.proxied) extras.push('proxied');
  const suffix = extras.length ? ` (${extras.join(', ')})` : '';
  return `${rec.type.padEnd(7)} ${rec.host} -> ${rec.value} ttl=${rec.ttl}${suffix}`;
}

function resolveProviderId(role: string, value: string | undefined): ProviderId {
  if (!value) {
    throw new Error(`Missing --${role} <provider>. Expected one of: ${PROVIDER_IDS.join(', ')}`);
  }
  if (!isProviderId(value)) {
    throw new Error(`Unknown ${role} provider "${value}". Expected one of: ${PROVIDER_IDS.join(', ')}`);
  }
  return value;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const fromId = resolveProviderId('from', opts.from);
  const toId = resolveProviderId('to', opts.to);
  if (fromId === toId) {
    throw new Error(`--from and --to must differ (both are "${fromId}").`);
  }

  const zone = loadDomain();
  const ctx: ProviderContext = { zone };

  // Construct providers — each validates only its own slice of .env.
  const source: Provider = getProvider(fromId);
  const target: Provider = getProvider(toId);

  if (opts.dryRun) {
    logger.info('Running in DRY-RUN mode — no records will be created in the target.');
  }
  logger.info(`Migrating zone "${zone}": ${fromId} -> ${toId}`);

  // 1. Pull source records as MIR.
  const sourceRecords = await source.listRecords(ctx);
  logger.info(`Fetched ${sourceRecords.length} record(s) from ${fromId}.`);

  // 2. Snapshot existing target records for idempotency.
  const existing = await target.listRecords(ctx);
  const existingKeys = new Set(existing.map((r) => recordIdentity(r)));
  logger.info(`Target ${toId} already has ${existing.length} record(s).`);

  const stats = { created: 0, skipped: 0, existed: 0, failed: 0 };

  for (const rec of sourceRecords) {
    const decision = planRecord(rec, target.capabilities, ctx);
    if (!decision.ok) {
      logger.skip(`${rec.type} ${rec.host} — ${decision.reason}`);
      stats.skipped += 1;
      continue;
    }

    if (existingKeys.has(recordIdentity(rec))) {
      logger.skip(`${describe(rec)} — already exists in ${toId}`);
      stats.existed += 1;
      continue;
    }

    if (opts.dryRun) {
      logger.dryRun(`would create: ${describe(rec)}`);
      stats.created += 1;
      continue;
    }

    try {
      const recordId = await target.createRecord(ctx, rec);
      logger.success(`created: ${describe(rec)} [recordId=${recordId}]`);
      // Guard against duplicate records within the same source export.
      existingKeys.add(recordIdentity(rec));
      stats.created += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`failed: ${describe(rec)} — ${msg}`);
      stats.failed += 1;
    }
  }

  logger.info(
    `Done. ${opts.dryRun ? 'would create' : 'created'}=${stats.created}, ` +
      `existed=${stats.existed}, skipped=${stats.skipped}, failed=${stats.failed}`,
  );

  return stats.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
