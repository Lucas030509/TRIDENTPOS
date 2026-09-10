/**
 * TRIDENTPOS Edge Database Test-Only Access Utility
 * Exclusively for test assertions. NOT exported by production package indices.
 * Uses a module-private WeakMap that is completely unreachable from the
 * EdgeDatabaseService instance, prototype, global symbol registry, or public exports.
 */

import type Database from 'better-sqlite3';
import type { EdgeDatabaseService } from './edge-database.js';

const testRegistry = new WeakMap<EdgeDatabaseService, Database.Database>();

/**
 * Registers the native SQLite database instance in the module-private WeakMap.
 * Called only during EdgeDatabaseService instantiation.
 */
export function registerTestNativeDatabase(
  service: EdgeDatabaseService,
  db: Database.Database,
): void {
  testRegistry.set(service, db);
}

/**
 * Retrieves the native SQLite handle from the module-private WeakMap.
 * Available only to test suites importing this internal file directly.
 */
export function getTestNativeDatabase(service: EdgeDatabaseService): Database.Database {
  const db = testRegistry.get(service);
  if (!db) {
    throw new Error('Test native database accessor is not available on service instance');
  }
  return db;
}
