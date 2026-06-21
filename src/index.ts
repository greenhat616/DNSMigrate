#!/usr/bin/env node
import { loadConfig } from './config';
import { DnsPod } from './dnspod';
import { Esa } from './esa';
import { mapRecord, recordKey, type PlannedRecord } from './mapping';
import { logger } from './logger';

interface CliOptions {
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, help: false };
  for (const arg of argv) {
    switch (arg) {
      case '--dry-run':
      case '-n':
        opts.dryRun = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        logger.warn(`Unknown argument ignored: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
dnspod-to-esa — import DNSPod DNS records into Aliyun ESA

Usage:
  pnpm import [--dry-run]
  pnpm dry-run
  node dist/index.js [options]

Options:
  -n, --dry-run   Show what would be created without writing to ESA
  -h, --help      Show this help

Configuration is read from .env (see .env.example).
`);
}

function describe(plan: PlannedRecord): string {
  const extras: string[] = [];
  if (plan.data.priority !== undefined) extras.push(`prio=${plan.data.priority}`);
  if (plan.proxied) extras.push('proxied');
  const suffix = extras.length ? ` (${extras.join(', ')})` : '';
  return `${plan.type.padEnd(7)} ${plan.recordName} -> ${plan.data.value} ttl=${plan.ttl}${suffix}`;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const config = loadConfig();
  if (opts.dryRun) {
    logger.info('Running in DRY-RUN mode — no records will be created in ESA.');
  }
  logger.info(`Source domain (DNSPod): ${config.dnspod.domain}`);

  const dnspod = new DnsPod(config.dnspod);
  const esa = new Esa(config.esa);

  // 1. Fetch source records.
  const sourceRecords = await dnspod.listRecords(config.dnspod.domain);
  logger.info(`Fetched ${sourceRecords.length} record(s) from DNSPod.`);

  // 2. Resolve the target ESA site.
  const siteId =
    config.esa.siteId ?? (await esa.resolveSiteId(config.esa.siteName));
  logger.info(
    `Target ESA site: ${config.esa.siteName} (siteId=${siteId})` +
      (config.esa.siteId ? ' [from .env]' : ' [resolved]'),
  );

  // 3. Snapshot existing ESA records for idempotency.
  const existing = await esa.listRecords(siteId);
  const existingKeys = new Set(existing.map((r) => recordKey(r.recordName, r.recordType)));
  logger.info(`ESA site already has ${existing.length} record(s).`);

  const stats = { created: 0, skipped: 0, existed: 0, failed: 0 };

  for (const rec of sourceRecords) {
    const result = mapRecord(rec, config.dnspod.domain, config.proxied);

    if (!result.ok) {
      logger.skip(`${rec.type} ${rec.name} — ${result.reason}`);
      stats.skipped += 1;
      continue;
    }

    const { plan } = result;
    if (existingKeys.has(recordKey(plan.recordName, plan.type))) {
      logger.skip(`${describe(plan)} — already exists in ESA`);
      stats.existed += 1;
      continue;
    }

    if (opts.dryRun) {
      logger.dryRun(`would create: ${describe(plan)}`);
      stats.created += 1;
      continue;
    }

    try {
      const recordId = await esa.createRecord(siteId, plan);
      logger.success(`created: ${describe(plan)} [recordId=${recordId}]`);
      // Guard against duplicate names within the same DNSPod export.
      existingKeys.add(recordKey(plan.recordName, plan.type));
      stats.created += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`failed: ${describe(plan)} — ${msg}`);
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
