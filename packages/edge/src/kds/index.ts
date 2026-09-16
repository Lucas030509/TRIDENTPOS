/**
 * TRIDENTPOS Edge KDS Transport Subsystem (WP-015)
 * Exports the local WebSocket dispatcher and ESC/POS network printer
 * transport primitives. Generic device I/O only -- zero KDS/order business
 * semantics live in this package (ADR-013 Invariant 1).
 */

export * from './ws-dispatcher.js';
export * from './escpos-printer-client.js';
export * from './escpos-formatter.js';
