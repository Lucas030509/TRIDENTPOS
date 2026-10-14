/**
 * TRIDENTPOS WP-024: Staff RBAC & User Management View
 * Manages operator access, branch scoping, and role-based permissions matrix.
 */

import React, { useState } from 'react';
import type { BackofficeRole, BackofficeUser, TableColumn } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import { ROLE_DEFAULT_PERMISSIONS } from '../../auth/rbac-guard.js';

export interface StaffRbacViewProps {
  users: readonly BackofficeUser[];
  onUpdateUserRoles?: (userId: string, newRoles: readonly BackofficeRole[]) => void;
}

export function StaffRbacView({
  users,
  onUpdateUserRoles: _onUpdateUserRoles,
}: StaffRbacViewProps): React.JSX.Element {
  const [selectedUser, setSelectedUser] = useState<BackofficeUser | null>(null);

  const columns: readonly TableColumn<BackofficeUser>[] = [
    { key: 'displayName', header: 'Nombre', sortable: true },
    { key: 'email', header: 'Correo Electrónico', sortable: true },
    {
      key: 'roles',
      header: 'Roles Asignados',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {row.roles.map((r) => (
            <span
              key={r}
              className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-neutral-800 text-neutral-300 border border-neutral-700"
            >
              {r}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'assignedBranchIds',
      header: 'Sucursales Permitidas',
      render: (row) =>
        row.assignedBranchIds.length === 0 ? (
          <span className="text-xs text-neutral-500 italic">Todas (Global)</span>
        ) : (
          <span className="text-xs font-mono text-neutral-300">
            {row.assignedBranchIds.join(', ')}
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (row) => (
        <button
          onClick={() => setSelectedUser(row)}
          className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 underline"
        >
          Permisos
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Usuarios & Control de Acceso (RBAC)
          </h1>
          <p className="text-xs text-neutral-400">
            Administración de personal, asignación de roles operativos y restricción de navegación.
          </p>
        </div>
      </div>

      <DataTable
        data={users as unknown as Record<string, unknown>[]}
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
        emptyMessage="No se encontraron usuarios registrados."
      />

      {/* Permissions Detail Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">{selectedUser.displayName}</h3>
                <span className="text-xs text-neutral-400">{selectedUser.email}</span>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <span className="text-xs font-semibold text-neutral-300">
                Permisos Efectivos Otorgados:
              </span>
              <div className="max-h-60 overflow-y-auto space-y-1 bg-neutral-950 p-3 rounded border border-neutral-800">
                {Array.from(
                  new Set([
                    ...selectedUser.permissions,
                    ...selectedUser.roles.flatMap((r) => ROLE_DEFAULT_PERMISSIONS[r] || []),
                  ]),
                ).map((perm) => (
                  <div key={perm} className="text-xs font-mono text-emerald-400 flex items-center gap-2">
                    <span>✓</span>
                    <span>{perm}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedUser(null)}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-xs font-medium"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
