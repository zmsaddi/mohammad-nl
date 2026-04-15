'use client';
// v1 pre-delivery Item 3 — click-to-sort hook shared by all list pages.
// Keeps the sort state scoped to the component, memoizes the sorted
// array, and returns a small API the table uses for header clicks and
// the ↑↓ indicator.
//
// Usage:
//   const { sortedRows, requestSort, getSortIndicator } = useSortedRows(
//     filteredRows,
//     { key: 'date', direction: 'desc' }, // optional initial sort
//   );
//
//   <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }}>
//     التاريخ{getSortIndicator('date')}
//   </th>
//   ...
//   {sortedRows.map(...)}

import { useState, useMemo, useCallback } from 'react';

export function useSortedRows(rows, defaultSort = null) {
  const [sortConfig, setSortConfig] = useState(defaultSort || { key: null, direction: null });

  const sortedRows = useMemo(() => {
    if (!sortConfig?.key) return rows;
    const { key, direction } = sortConfig;
    // Non-destructive sort: copy first so the caller's array is unchanged.
    return [...rows].sort((a, b) => {
      let aVal = a?.[key];
      let bVal = b?.[key];
      // null/undefined sort to the end regardless of direction, so users
      // always see populated rows first.
      const aNil = aVal == null || aVal === '';
      const bNil = bVal == null || bVal === '';
      if (aNil && bNil) return 0;
      if (aNil) return 1;
      if (bNil) return -1;

      // ARC-06: NUMERIC columns come back as strings from @vercel/postgres.
      // Coerce when both sides parse cleanly as numbers, so sorting by
      // "total" or "remaining" is numeric, not lexicographic.
      const aNum = typeof aVal === 'number' ? aVal : parseFloat(aVal);
      const bNum = typeof bVal === 'number' ? bVal : parseFloat(bVal);
      const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);
      if (bothNumeric) {
        return direction === 'asc' ? aNum - bNum : bNum - aNum;
      }

      // Date strings (YYYY-MM-DD) sort lexicographically in chronological
      // order. Everything else goes through localeCompare so Arabic
      // client names and Latin product names sort consistently.
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const cmp = aStr.localeCompare(bStr);
      return direction === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortConfig]);

  const requestSort = useCallback((key) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  }, []);

  const getSortIndicator = useCallback(
    (key) => {
      if (sortConfig?.key !== key) return '';
      return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
    },
    [sortConfig]
  );

  return { sortedRows, requestSort, getSortIndicator, sortConfig };
}
