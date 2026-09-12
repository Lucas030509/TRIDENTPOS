/**
 * TRIDENTPOS Internal Outbox Persistence Adapter
 * Strictly module-internal to @trident/edge.
 * NEVER exported from @trident/edge public entrypoint or public index.
 */

import type Database from 'better-sqlite3';
import type { EdgeDatabaseService } from './edge-database.js';

export interface InternalOutboxAdapter {
  exec(sql: string): void;
  prepare(sql: string): Database.Statement;
}

const internalOutboxAdapters = new WeakMap<EdgeDatabaseService, InternalOutboxAdapter>();

export function registerInternalOutboxAdapter(
  service: EdgeDatabaseService,
  adapter: InternalOutboxAdapter,
): void {
  internalOutboxAdapters.set(service, adapter);
}

export function getInternalOutboxAdapter(service: EdgeDatabaseService): InternalOutboxAdapter {
  const adapter = internalOutboxAdapters.get(service);
  if (!adapter) {
    throw new Error('Internal outbox adapter not registered for this EdgeDatabaseService instance');
  }
  return adapter;
}
