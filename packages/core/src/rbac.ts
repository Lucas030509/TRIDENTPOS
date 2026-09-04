/**
 * @trident/core - Role-Based Access Control (RBAC) Evaluation Engine
 *
 * Governed authority:
 * user_roles -> roles -> roles.permissions JSONB
 *
 * Rules:
 * - permissions MUST be a JSON array of permission strings.
 * - Malformed permissions JSON -> FAIL CLOSED.
 * - Client-supplied role, permissions, or claims are strictly ignored.
 * - Permission present: ALLOW; absent: DENY; inactive role: DENY.
 */

import { ok, err, type Result } from './index.js';

export class RbacEvaluationError extends Error {
  public readonly code: 'MALFORMED_PERMISSIONS' | 'EMPTY_PERMISSION_IDENTIFIER';

  constructor(code: 'MALFORMED_PERMISSIONS' | 'EMPTY_PERMISSION_IDENTIFIER', message: string) {
    super(`RBAC_EVALUATION_ERROR [${code}]: ${message}`);
    this.name = 'RbacEvaluationError';
    this.code = code;
  }
}

/**
 * Validates and extracts a typed list of permission strings from a raw JSONB column value.
 * Fails closed if the input is not a valid JSON array of non-empty strings.
 */
export function parseRolePermissions(
  permissionsValue: unknown,
): Result<readonly string[], RbacEvaluationError> {
  if (!Array.isArray(permissionsValue)) {
    return err(
      new RbacEvaluationError(
        'MALFORMED_PERMISSIONS',
        `Permissions must be a JSON array, got: ${typeof permissionsValue}`,
      ),
    );
  }

  const result: string[] = [];
  for (let i = 0; i < permissionsValue.length; i++) {
    const item = permissionsValue[i];
    if (typeof item !== 'string' || item.trim().length === 0) {
      return err(
        new RbacEvaluationError(
          'MALFORMED_PERMISSIONS',
          `Permissions item at index ${i} is not a valid non-empty string`,
        ),
      );
    }
    result.push(item.trim());
  }

  return ok(result);
}

/**
 * Evaluates whether an authenticated principal holds a specific required permission.
 * Performs deterministic string matching against evaluated permissions.
 */
export function hasPermission(
  grantedPermissions: readonly string[],
  requiredPermission: string,
): boolean {
  if (
    !requiredPermission ||
    typeof requiredPermission !== 'string' ||
    requiredPermission.trim().length === 0
  ) {
    return false;
  }
  return grantedPermissions.includes(requiredPermission.trim());
}

/**
 * Evaluates whether an authenticated principal holds all of the specified required permissions.
 */
export function hasAllPermissions(
  grantedPermissions: readonly string[],
  requiredPermissions: readonly string[],
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }
  return requiredPermissions.every((perm) => hasPermission(grantedPermissions, perm));
}

/**
 * Evaluates whether an authenticated principal holds at least one of the specified permissions.
 */
export function hasAnyPermission(
  grantedPermissions: readonly string[],
  requiredPermissions: readonly string[],
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return false;
  }
  return requiredPermissions.some((perm) => hasPermission(grantedPermissions, perm));
}
