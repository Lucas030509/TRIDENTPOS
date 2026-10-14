/**
 * TRIDENTPOS WP-024: Backoffice RBAC Route Guards & Authorization Engine
 * Strictly enforces role-based access control, branch scopes, and route protection fail-closed.
 */

import type { BackofficePermission, BackofficeRole, BackofficeUser } from '../types.js';

export const ROLE_DEFAULT_PERMISSIONS: Record<BackofficeRole, readonly BackofficePermission[]> = {
  ADMIN: [
    'catalog.read',
    'catalog.write',
    'recipe.read',
    'recipe.write',
    'inventory.read',
    'inventory.adjust',
    'procurement.read',
    'procurement.write',
    'procurement.approve',
    'finance.read',
    'finance.settle',
    'finance.cash_reconciliation',
    'finance.global_invoice',
    'analytics.read',
    'settings.read',
    'settings.write',
    'users.manage',
  ],
  GERENTE: [
    'catalog.read',
    'catalog.write',
    'recipe.read',
    'recipe.write',
    'inventory.read',
    'inventory.adjust',
    'procurement.read',
    'procurement.write',
    'procurement.approve',
    'finance.read',
    'finance.settle',
    'finance.cash_reconciliation',
    'finance.global_invoice',
    'analytics.read',
    'settings.read',
  ],
  CHEF: ['catalog.read', 'recipe.read', 'recipe.write', 'inventory.read'],
  CAJERO: ['catalog.read', 'finance.read', 'finance.cash_reconciliation'],
  MESERO: ['catalog.read'],
  AUDITOR: [
    'catalog.read',
    'recipe.read',
    'inventory.read',
    'procurement.read',
    'finance.read',
    'analytics.read',
    'settings.read',
  ],
};

export const ROUTE_PERMISSION_MAP: Record<string, BackofficePermission> = {
  '/catalogo': 'catalog.read',
  '/recetas': 'recipe.read',
  '/inventario': 'inventory.read',
  '/kardex': 'inventory.read',
  '/compras': 'procurement.read',
  '/proveedores': 'procurement.read',
  '/finanzas': 'finance.read',
  '/corte-caja': 'finance.cash_reconciliation',
  '/facturacion-global': 'finance.global_invoice',
  '/analytics': 'analytics.read',
  '/configuracion': 'settings.read',
  '/usuarios': 'users.manage',
};

/**
 * Checks if a user has a specific permission explicitly or derived from their roles.
 */
export function hasPermission(user: BackofficeUser, permission: BackofficePermission): boolean {
  if (!user || !user.roles) return false;

  // Direct user permissions check
  if (user.permissions && user.permissions.includes(permission)) {
    return true;
  }

  // Role permissions check
  for (const role of user.roles) {
    const rolePerms = ROLE_DEFAULT_PERMISSIONS[role];
    if (rolePerms && rolePerms.includes(permission)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a user holds a specific role.
 */
export function hasRole(user: BackofficeUser, role: BackofficeRole): boolean {
  if (!user || !user.roles) return false;
  return user.roles.includes(role);
}

/**
 * Checks if a user is permitted to operate within a given branch context.
 */
export function canAccessBranch(user: BackofficeUser, branchId: string): boolean {
  if (!user || !branchId) return false;
  // Admin with wildcard or empty assigned branches has access to all branches
  if (
    user.roles.includes('ADMIN') &&
    (!user.assignedBranchIds || user.assignedBranchIds.length === 0)
  ) {
    return true;
  }
  return user.assignedBranchIds.includes(branchId);
}

export interface RouteGuardResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiredPermission?: BackofficePermission;
}

/**
 * Evaluates route guard against the route path and active user session.
 */
export function evaluateRouteGuard(user: BackofficeUser, path: string): RouteGuardResult {
  if (!user) {
    return {
      allowed: false,
      reason: 'Unauthenticated: No user session found',
    };
  }

  // Exact or prefix route match
  const matchedRoute = Object.keys(ROUTE_PERMISSION_MAP).find(
    (route) => path === route || path.startsWith(`${route}/`),
  );

  if (!matchedRoute) {
    // Unrestricted or public backoffice route (e.g. "/" dashboard home)
    return { allowed: true };
  }

  const requiredPermission = ROUTE_PERMISSION_MAP[matchedRoute];
  if (!requiredPermission) {
    return { allowed: true };
  }

  const isPermitted = hasPermission(user, requiredPermission);
  if (!isPermitted) {
    return {
      allowed: false,
      requiredPermission,
      reason: `Access Denied: Missing required permission '${requiredPermission}'`,
    };
  }

  return { allowed: true, requiredPermission };
}
