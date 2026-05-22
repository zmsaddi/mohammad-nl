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
  // Use Number(), NOT parseFloat(): parseFloat is lenient and reads only the
  // leading number, so a date string like "2026-05-01" became 2026 — making
  // every same-year date compare equal and date sorting silently fall back to
  // id order. Number() is strict (the WHOLE string must be numeric), so dates
  // (and any non-numeric string) fall through to the locale string compare,
  // where ISO "YYYY-MM-DD" sorts chronologically. Clean numbers still compare
  // numerically.
  const aNum = typeof aVal === 'number' ? aVal : Number(aVal);
  const bNum = typeof bVal === 'number' ? bVal : Number(bVal);
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
      // Tiebreaker by id, following the sort DIRECTION so rows that share the
      // primary value stay consistent: ascending date → ascending id (oldest /
      // INV-001 first within a day), descending date → descending id. Before,
      // the id tiebreaker was always descending, so an ascending date sort
      // showed same-day rows in reverse (004, 003, 002, 001).
      if (a?.id != null && b?.id != null) {
        return direction === 'asc' ? a.id - b.id : b.id - a.id;
      }
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

  // Set key + direction explicitly (used by the always-visible SortControl on
  // mobile + desktop, where the field and the asc/desc toggle are separate
  // controls — unlike requestSort which flips direction on repeat clicks).
  const setSort = useCallback((key, direction) => {
    setSortConfig({ key, direction: direction === 'asc' ? 'asc' : 'desc' });
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

  return { sortedRows, requestSort, setSort, getSortIndicator, getAriaSort, sortConfig };
}
