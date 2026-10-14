/**
 * TRIDENTPOS WP-024: Catalog & Product Management View
 * Renders master product and category lists with ADR-012 Scale-4 price formatting and search.
 */

import React, { useState } from 'react';
import type { CategoryItem, ProductItem, TableColumn } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import { formatCurrencyScale4 } from '../../numerics.js';

export interface CatalogViewProps {
  categories: readonly CategoryItem[];
  products: readonly ProductItem[];
  onSelectProduct?: (product: ProductItem) => void;
  onOpenRecipeBuilder?: (product: ProductItem) => void;
}

export function CatalogView({
  categories,
  products,
  onSelectProduct,
  onOpenRecipeBuilder,
}: CatalogViewProps): React.JSX.Element {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredProducts = products.filter((p) => {
    if (selectedCategoryId !== 'ALL' && p.categoryId !== selectedCategoryId) {
      return false;
    }
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    }
    return true;
  });

  const columns: readonly TableColumn<ProductItem>[] = [
    { key: 'code', header: 'Código', sortable: true },
    { key: 'name', header: 'Producto', sortable: true },
    {
      key: 'categoryId',
      header: 'Categoría',
      render: (row) => row.categoryName || categories.find((c) => c.id === row.categoryId)?.name || row.categoryId,
    },
    {
      key: 'basePriceScale4',
      header: 'Precio Base',
      sortable: true,
      align: 'right',
      render: (row) => formatCurrencyScale4(row.basePriceScale4),
    },
    {
      key: 'hasRecipe',
      header: 'Receta',
      align: 'center',
      render: (row) =>
        row.hasRecipe ? (
          <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-900/60 text-emerald-300 border border-emerald-600/40">
            Con Receta
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-[10px] bg-neutral-800 text-neutral-400">
            Sin Receta
          </span>
        ),
    },
    {
      key: 'isActive',
      header: 'Estado',
      align: 'center',
      render: (row) =>
        row.isActive ? (
          <span className="text-emerald-400 font-semibold text-xs">Activo</span>
        ) : (
          <span className="text-neutral-500 font-semibold text-xs">Inactivo</span>
        ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (row) => (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onSelectProduct?.(row)}
            className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Editar
          </button>
          <button
            onClick={() => onOpenRecipeBuilder?.(row)}
            className="px-2 py-1 text-xs bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-200"
          >
            Receta
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Catálogo de Productos</h1>
          <p className="text-xs text-neutral-400">
            Administración centralizada de platillos, bebidas, categorías y precios base.
          </p>
        </div>
        <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shadow-sm transition-colors">
          + Nuevo Producto
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-neutral-900 p-4 rounded-lg border border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400">Categoría:</span>
          <select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="bg-neutral-800 text-xs text-white border border-neutral-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">Todas las Categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-64">
          <input
            type="text"
            placeholder="Buscar por nombre o código..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-800 text-xs text-white border border-neutral-700 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 placeholder-neutral-500"
          />
        </div>
      </div>

      {/* Table */}
      <DataTable
        data={filteredProducts as unknown as Record<string, unknown>[]}
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
        emptyMessage="No se encontraron productos que coincidan con la búsqueda."
      />
    </div>
  );
}
