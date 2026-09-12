/**
 * @trident/edge
 * TRIDENTPOS Edge Host Runtime & Electron Security Hardening Layer
 * Authoritative implementation per SECURITY_ARCHITECTURE.md Sec. 9 and ACR-2026-009.
 */

import { CORE_PACKAGE_NAME } from '@trident/core';

export const EDGE_PACKAGE_NAME = '@trident/edge';
export const EDGE_PACKAGE_VERSION = '0.1.0';

export interface EdgePackageInfo {
  name: string;
  version: string;
  coreDependency: string;
}

export function getEdgePackageInfo(): EdgePackageInfo {
  return {
    name: EDGE_PACKAGE_NAME,
    version: EDGE_PACKAGE_VERSION,
    coreDependency: CORE_PACKAGE_NAME,
  };
}

// Re-export Security Profile
export * from './security-profile.js';

// Re-export IPC Channels and Dispatch Guard
export * from './ipc-channels.js';

// Re-export Navigation and Window Lock
export * from './navigation-lock.js';

// Re-export Configuration & Secret Leakage Prevention
export * from './config.js';

// Re-export Worker Process Separation Scaffold
export * from './worker-boundary.js';

// Re-export Application Main & Window Manager
export * from './main.js';

// Re-export Preload Bridge Interface
export * from './preload.js';

// Re-export Proof Renderer & Audit
export * from './renderer.js';

// Re-export Local Database & Durability Manager (WP-008)
export * from './db/index.js';

// Re-export Edge Enrollment & Trust Bootstrap (WP-009)
export * from './enrollment/index.js';
