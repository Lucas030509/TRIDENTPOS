/**
 * TRIDENTPOS Edge Database Test-Only Access Utility
 * Exclusively for test assertions. NOT exported by production package indices.
 */

import type Database from 'better-sqlite3';
import type { EdgeDatabaseService } from './edge-database.js';

export const TEST_DB_SYMBOL = Symbol.for('trident.edge.test.nativeDatabase');

export function getTestNativeDatabase(service: EdgeDatabaseService): Database.Database {
  const accessor = (service as unknown as Record<symbol, () => Database.Database>)[TEST_DB_SYMBOL];
  if (typeof accessor !== 'function') {
    throw new Error('Test native database accessor is not available on service instance');
  }
  return accessor.call(service);
}
