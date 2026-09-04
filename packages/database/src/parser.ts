import fs from 'node:fs';
import path from 'node:path';
import { computeChecksum } from './checksum.js';
import type { MigrationFile } from './types.js';

const CLOUD_MIGRATION_FILENAME = /^(\d{14})_(.+)\.sql$/;

function assertValidTimestampId(id: string, filename: string): void {
  const year = Number(id.slice(0, 4));
  const month = Number(id.slice(4, 6));
  const day = Number(id.slice(6, 8));
  const hour = Number(id.slice(8, 10));
  const minute = Number(id.slice(10, 12));
  const second = Number(id.slice(12, 14));

  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid =
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day &&
    candidate.getUTCHours() === hour &&
    candidate.getUTCMinutes() === minute &&
    candidate.getUTCSeconds() === second;

  if (!valid) {
    throw new Error(
      `Invalid migration timestamp '${id}' in '${filename}'. Expected a real UTC-style YYYYMMDDHHMMSS timestamp.`,
    );
  }
}

/**
 * Parses a Cloud PostgreSQL migration SQL file into a MigrationFile object.
 * Frozen DATA_ARCHITECTURE.md §8.1 requires YYYYMMDDHHMMSS_name.sql.
 * File format expects:
 * -- Up
 * <SQL statements>
 *
 * -- Down (optional)
 * <SQL statements>
 */
export function parseMigrationFile(filepath: string): MigrationFile {
  const filename = path.basename(filepath);
  const match = filename.match(CLOUD_MIGRATION_FILENAME);
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Invalid migration filename format: '${filename}'. Expected 'YYYYMMDDHHMMSS_<name>.sql'`,
    );
  }

  const id = match[1];
  const name = match[2];
  assertValidTimestampId(id, filename);

  const rawContent = fs.readFileSync(filepath, 'utf8');
  const checksum = computeChecksum(rawContent);

  const upMatch = rawContent.match(/--\s*Up\s*([\s\S]*?)(?=--\s*Down|$)/i);
  const downMatch = rawContent.match(/--\s*Down\s*([\s\S]*$)/i);

  const upSql = upMatch && upMatch[1] ? upMatch[1].trim() : rawContent.trim();
  const downSql = downMatch && downMatch[1] ? downMatch[1].trim() : undefined;

  if (!upSql) {
    throw new Error(`Migration '${filename}' does not contain valid Up SQL commands.`);
  }

  return {
    id,
    name,
    filename,
    filepath,
    checksum,
    upSql,
    downSql,
  };
}

/**
 * Discovers and loads Cloud migrations in deterministic timestamp order.
 * Duplicate timestamp IDs are rejected before any SQL is executed.
 */
export function loadMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory does not exist: ${migrationsDir}`);
  }

  const entries = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const migrations = entries.map((file) => parseMigrationFile(path.join(migrationsDir, file)));
  const seenIds = new Set<string>();

  for (const migration of migrations) {
    if (seenIds.has(migration.id)) {
      throw new Error(
        `Duplicate migration timestamp '${migration.id}' detected. Migration IDs must be unique and append-only.`,
      );
    }
    seenIds.add(migration.id);
  }

  return migrations;
}
