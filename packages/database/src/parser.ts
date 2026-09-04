import fs from 'node:fs';
import path from 'node:path';
import { computeChecksum } from './checksum.js';
import type { MigrationFile } from './types.js';

/**
 * Parses a migration SQL file into a MigrationFile object.
 * File format expects:
 * -- Up
 * <SQL statements>
 *
 * -- Down (optional)
 * <SQL statements>
 */
export function parseMigrationFile(filepath: string): MigrationFile {
  const filename = path.basename(filepath);
  const match = filename.match(/^([0-9]+)_(.+)\.sql$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Invalid migration filename format: '${filename}'. Expected '<number>_<name>.sql'`,
    );
  }

  const id = match[1];
  const name = match[2];
  const rawContent = fs.readFileSync(filepath, 'utf8');
  const checksum = computeChecksum(rawContent);

  // Split into -- Up and -- Down sections
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
 * Discovers and loads all .sql migration files from a directory, sorted lexicographically by filename.
 */
export function loadMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory does not exist: ${migrationsDir}`);
  }

  const entries = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return entries.map((file) => parseMigrationFile(path.join(migrationsDir, file)));
}
