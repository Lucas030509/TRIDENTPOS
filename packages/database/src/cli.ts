import { getPool, closePool, sanitizeConnectionString, resolveDatabaseUrl } from './connection.js';
import { migrateUp, migrateDown, getMigrationStatus } from './runner.js';

async function main() {
  const command = process.argv[2] || 'up';
  const rawUrl = resolveDatabaseUrl();
  const safeUrl = sanitizeConnectionString(rawUrl);

  console.log(`[TRIDENT Database Migration Engine]`);
  console.log(`Target database: ${safeUrl}`);
  console.log(`Command: ${command}`);

  const pool = getPool();

  try {
    switch (command) {
      case 'up': {
        const result = await migrateUp(pool);
        if (result.alreadyUpToDate) {
          console.log('Database schema is already up to date.');
        } else {
          console.log(`Successfully applied ${result.applied.length} migration(s):`);
          for (const m of result.applied) {
            console.log(`  + ${m}`);
          }
        }
        break;
      }
      case 'down': {
        const result = await migrateDown(pool);
        if (result.reverted === 'none') {
          console.log('No applied migrations found to revert.');
        } else {
          console.log(`Successfully reverted migration: ${result.reverted}`);
        }
        break;
      }
      case 'status': {
        const statuses = await getMigrationStatus(pool);
        console.log('Migration Status:');
        for (const s of statuses) {
          const state = s.applied
            ? `APPLIED (order: ${s.executionOrder}, checksum_match: ${s.checksumMatches})`
            : 'PENDING';
          console.log(`  [${s.id}] ${s.name} -> ${state}`);
        }
        break;
      }
      default: {
        console.error(`Unknown command '${command}'. Permitted: up, down, status.`);
        process.exit(1);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MIGRATION ERROR] ${msg}`);
    process.exit(1);
  } finally {
    await closePool(pool);
  }
}

main().catch((err) => {
  console.error('[UNHANDLED FATAL ERROR]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
