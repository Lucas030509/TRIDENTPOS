/**
 * @trident/pos-edge-runtime
 * TRIDENTPOS Edge POS Composition Root & LAN REST Daemon (ADR-013)
 */

export const POS_EDGE_RUNTIME_PACKAGE_NAME = '@trident/pos-edge-runtime';
export const POS_EDGE_RUNTIME_PACKAGE_VERSION = '0.1.0';

export * from './schema.js';
export * from './dining-sqlite-repository.js';
export * from './fastify-app.js';

// WP-015: KDS LAN Event Dispatcher & Printer Service composition
export * from './kds-schema.js';
export * from './kds-sqlite-repository.js';
export * from './printer-queue-runner.js';
export * from './kds-runtime.js';
