/**
 * TRIDENTPOS WP-024: High-Performance Data Table Engine & React Component
 * Provides smooth rendering of tabular datasets with sorting, filtering, searching, and pagination.
 */

import React from 'react';
import type {
  TableColumn,
  TableFilterState,
  TablePaginationState,
  TableResult,
  TableSortState,
} from '../../types.js';

export interface ProcessTableDataOptions<T> {
  data: readonly T[];
  sort?: TableSortState;
  filters?: TableFilterState;
  searchQuery?: string;
  searchFields?: readonly (keyof T)[];
  pagination?: TablePaginationState;
}

/**
 * Pure data transformation for tables: applies search filter, column filters, sorting, and pagination.
 */
export function processTableData<T extends Record<string, unknown>>(
  options: ProcessTableDataOptions<T>,
): TableResult<T> {
  let items = [...options.data];

  // 1. Text Search across defined fields
  if (options.searchQuery && options.searchQuery.trim().length > 0) {
    const q = options.searchQuery.toLowerCase().trim();
    items = items.filter((row) => {
      if (options.searchFields && options.searchFields.length > 0) {
        return options.searchFields.some((field) => {
          const val = row[field];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(q);
        });
      }
      // Default: check all object values
      return Object.values(row).some(
        (val) => val !== undefined && val !== null && String(val).toLowerCase().includes(q),
      );
    });
  }

  // 2. Column-specific filters
  if (options.filters) {
    for (const [key, filterVal] of Object.entries(options.filters)) {
      if (filterVal !== undefined && filterVal.trim().length > 0) {
        const fv = filterVal.toLowerCase().trim();
        items = items.filter((row) => {
          const cell = row[key];
          return cell !== undefined && cell !== null && String(cell).toLowerCase().includes(fv);
        });
      }
    }
  }

  // 3. Sorting
  if (options.sort) {
    const { key, direction } = options.sort;
    items.sort((a, b) => {
      const valA = a[key];
      const valB = b[key];

      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      let comparison = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        comparison = valA - valB;
      } else {
        comparison = String(valA).localeCompare(String(valB));
      }

      return direction === 'desc' ? -comparison : comparison;
    });
  }

  const totalCount = items.length;
  const pageSize = options.pagination?.pageSize || 25;
  const pageIndex = options.pagination?.pageIndex || 0;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  // 4. Pagination
  const start = pageIndex * pageSize;
  const pagedItems = items.slice(start, start + pageSize);

  return {
    items: pagedItems,
    totalCount,
    totalPages,
    pageIndex,
    pageSize,
  };
}

export interface DataTableProps<T extends Record<string, unknown>> {
  data: readonly T[];
  columns: readonly TableColumn<T>[];
  sort?: TableSortState;
  onSortChange?: (sort: TableSortState) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  pagination?: TablePaginationState;
  onPageChange?: (pageIndex: number) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  isLoading,
  emptyMessage = 'No records found',
}: DataTableProps<T>): React.JSX.Element {
  const result = processTableData({
    data,
    sort,
    pagination,
  });

  const handleHeaderClick = (colKey: string, sortable?: boolean) => {
    if (!sortable || !onSortChange) return;
    if (sort?.key === colKey) {
      onSortChange({
        key: colKey,
        direction: sort.direction === 'asc' ? 'desc' : 'asc',
      });
    } else {
      onSortChange({ key: colKey, direction: 'asc' });
    }
  };

  return (
    <div className="w-full border border-neutral-700 rounded-lg overflow-hidden bg-neutral-900 text-neutral-100">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="bg-neutral-800 text-neutral-300 border-b border-neutral-700">
            <tr>
              {columns.map((col) => {
                const isSorted = sort?.key === col.key;
                const sortIcon = isSorted ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : '';
                return (
                  <th
                    key={col.key}
                    onClick={() => handleHeaderClick(col.key, col.sortable)}
                    className={`px-4 py-3 font-semibold ${
                      col.sortable ? 'cursor-pointer select-none hover:text-white' : ''
                    } ${
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    }`}
                  >
                    {col.header}
                    {sortIcon}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-neutral-400">
                  Loading data...
                </td>
              </tr>
            ) : result.items.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-neutral-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              result.items.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-neutral-800/50 transition-colors">
                  {columns.map((col) => {
                    const cellVal = col.render ? col.render(row) : (row[col.key] as string | number);
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${
                          col.align === 'right'
                            ? 'text-right font-mono'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                        }`}
                      >
                        {cellVal !== undefined && cellVal !== null ? String(cellVal) : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && result.totalPages > 1 && (
        <div className="px-4 py-3 bg-neutral-800/80 border-t border-neutral-700 flex items-center justify-between text-xs text-neutral-400">
          <div>
            Showing {result.pageIndex * result.pageSize + 1} to{' '}
            {Math.min((result.pageIndex + 1) * result.pageSize, result.totalCount)} of{' '}
            {result.totalCount} entries
          </div>
          <div className="flex gap-1">
            <button
              disabled={result.pageIndex === 0}
              onClick={() => onPageChange?.(result.pageIndex - 1)}
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              Previous
            </button>
            <span className="px-2 py-1">
              Page {result.pageIndex + 1} of {result.totalPages}
            </span>
            <button
              disabled={result.pageIndex >= result.totalPages - 1}
              onClick={() => onPageChange?.(result.pageIndex + 1)}
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
