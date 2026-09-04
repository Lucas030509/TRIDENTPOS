/**
 * @trident/core
 * Platform Core package scaffolding & IAM domain contracts
 */

export const CORE_PACKAGE_NAME = '@trident/core';
export const CORE_PACKAGE_VERSION = '0.1.0';

export interface CorePackageInfo {
  name: string;
  version: string;
  initialized: boolean;
}

export function getCorePackageInfo(): CorePackageInfo {
  return {
    name: CORE_PACKAGE_NAME,
    version: CORE_PACKAGE_VERSION,
    initialized: true,
  };
}

export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export * from './principal.js';
export * from './jwt.js';
export * from './rbac.js';
export * from './pin.js';
