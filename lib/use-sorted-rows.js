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

function compareValues(aVal, bVal, direction) {
  const aNil = aVal == null || aVal === '';
  const bNil = bVal == null || bVal === '';
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  const aNum = typeof aVal === 'number' ? aVal : parseFloat(aVal);
  const bNum = typeof bVal === 'number' ? bVal : parseFloat(bVal);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
    return direction === 'asc' ? aNum - bNum : bNum - aNum;
  }
  const cmp = String(aVal).toLowerCase().localeCompare(String(bVal).toLowerCase());
  return direction === 'asc' ? cmp : -cmp;
}

export function useSortedRows(rows, defaultSort = null) {
  const [sortConfig, setSortConfig] = useState(defaultSort || { key: null, direction: null });

  const sortedRows = useMemo(() => {
    if (!sortConfig?.key) return rows;
    const { key, direction } = sortConfig;
    return [...rows].sort((a, b) => {
      const primary = compareValues(a?.[key], b?.[key], direction);
      if (primary !== 0) return primary;
      // Tiebreaker: id descending (newest first when primary key matches)
      if (a?.id != null && b?.id != null) return b.id - a.id;
      return 0;
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

  // v1.1 S3.7 — aria-sort for accessible sortable headers.
  // Returns 'ascending', 'descending', or 'none' per WAI-ARIA 1.1 §5.4.
  // Usage: <th aria-sort={getAriaSort('date')}>
  const getAriaSort = useCallback(
    (key) => {
      if (sortConfig?.key !== key) return 'none';
      return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
    },
    [sortConfig]
  );

  return { sortedRows, requestSort, getSortIndicator, getAriaSort, sortConfig };
}
