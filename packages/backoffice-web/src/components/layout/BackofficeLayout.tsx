/**
 * TRIDENTPOS WP-024: Backoffice Master Responsive Layout & Navigation
 * Responsive multi-tenant layout with Sidebar, TopBar, Branch Selector, and RBAC visibility filtering.
 */

import React from 'react';
import type { BackofficeUser, NavSection } from '../../types.js';
import { hasPermission } from '../../auth/rbac-guard.js';

export const BACKOFFICE_NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'operations',
    label: 'Catálogos & Cocina',
    items: [
      { id: 'catalog', label: 'Productos & Categorías', path: '/catalogo', requiredPermission: 'catalog.read' },
      { id: 'recipes', label: 'Formulación de Recetas', path: '/recetas', requiredPermission: 'recipe.read' },
      { id: 'stock', label: 'Almacenes & Stock', path: '/inventario', requiredPermission: 'inventory.read' },
      { id: 'kardex', label: 'Kárdex de Movimientos', path: '/kardex', requiredPermission: 'inventory.read' },
    ],
  },
  {
    id: 'procurement',
    label: 'Compras & Proveedores',
    items: [
      { id: 'orders', label: 'Órdenes de Compra', path: '/compras', requiredPermission: 'procurement.read' },
      { id: 'suppliers', label: 'Directorio Proveedores', path: '/proveedores', requiredPermission: 'procurement.read' },
    ],
  },
  {
    id: 'finance',
    label: 'Finanzas & Tesorería',
    items: [
      { id: 'balances', label: 'Cuentas CxP & CxC', path: '/finanzas', requiredPermission: 'finance.read' },
      { id: 'shifts', label: 'Conciliación de Caja', path: '/corte-caja', requiredPermission: 'finance.cash_reconciliation' },
      { id: 'global-inv', label: 'Factura Global Mes', path: '/facturacion-global', requiredPermission: 'finance.global_invoice' },
    ],
  },
  {
    id: 'bi',
    label: 'Inteligencia de Negocio',
    items: [
      { id: 'analytics', label: 'BI Dashboard & KPIs', path: '/analytics', requiredPermission: 'analytics.read' },
    ],
  },
  {
    id: 'admin',
    label: 'Administración',
    items: [
      { id: 'branches', label: 'Configuración Sucursales', path: '/configuracion', requiredPermission: 'settings.read' },
      { id: 'users', label: 'Usuarios & RBAC', path: '/usuarios', requiredPermission: 'users.manage' },
    ],
  },
];

export interface BackofficeLayoutProps {
  user: BackofficeUser;
  activePath: string;
  onNavigate?: (path: string) => void;
  activeBranchId: string;
  availableBranches?: readonly { id: string; name: string }[];
  onSwitchBranch?: (branchId: string) => void;
  children: React.ReactNode;
}

export function BackofficeLayout({
  user,
  activePath,
  onNavigate,
  activeBranchId,
  availableBranches = [],
  onSwitchBranch,
  children,
}: BackofficeLayoutProps): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col bg-neutral-900 border-r border-neutral-800">
        {/* Brand header */}
        <div className="h-16 px-6 flex items-center justify-between border-b border-neutral-800 bg-neutral-900">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center font-bold text-white text-xs">
              TP
            </span>
            <span className="font-bold tracking-tight text-white text-sm">
              TRIDENTPOS <span className="text-blue-400 font-normal text-xs">BACKOFFICE</span>
            </span>
          </div>
        </div>

        {/* Navigation links filtered by user RBAC */}
        <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {BACKOFFICE_NAV_SECTIONS.map((section) => {
            // Filter items user is permitted to see
            const visibleItems = section.items.filter(
              (item) => !item.requiredPermission || hasPermission(user, item.requiredPermission),
            );

            if (visibleItems.length === 0) return null;

            return (
              <div key={section.id}>
                <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  {section.label}
                </div>
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const isActive = activePath === item.path || activePath.startsWith(`${item.path}/`);
                    return (
                      <button
                        key={item.id}
                        onClick={() => onNavigate?.(item.path)}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-between ${
                          isActive
                            ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                            : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                        }`}
                      >
                        <span>{item.label}</span>
                        {item.badge && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-neutral-700 text-neutral-300 rounded">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User profile card */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/60">
          <div className="text-xs font-semibold text-white truncate">{user.displayName}</div>
          <div className="text-[11px] text-neutral-400 truncate">{user.email}</div>
          <div className="mt-1 flex gap-1">
            {user.roles.map((r) => (
              <span
                key={r}
                className="px-1.5 py-0.5 text-[9px] font-mono bg-neutral-800 border border-neutral-700 rounded text-neutral-300"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-8 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-4">
            <span className="text-xs text-neutral-400">Organización:</span>
            <span className="text-xs font-mono font-medium text-white px-2 py-1 bg-neutral-800 rounded border border-neutral-700">
              {user.orgId}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-400">Sucursal Activa:</span>
            {availableBranches.length > 0 ? (
              <select
                value={activeBranchId}
                onChange={(e) => onSwitchBranch?.(e.target.value)}
                className="bg-neutral-800 text-xs text-white border border-neutral-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
              >
                {availableBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.id})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-mono text-neutral-200">{activeBranchId}</span>
            )}
          </div>
        </header>

        {/* Scrollable page view container */}
        <main className="flex-1 overflow-y-auto p-8 bg-neutral-950">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
