// @vitest-environment jsdom
//
// Regression for the date-sort bug: compareValues used parseFloat, so
// "2026-05-01" became 2026 and every same-year date compared equal — date
// sorting silently degraded to id order. The fix (Number, which is NaN for date
// strings → locale compare of ISO dates) is pinned here, plus that numeric
// fields still sort numerically.
import './_setup-ui.js';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSortedRows } from '../../lib/use-sorted-rows.js';

const rows = [
  { id: 1, date: '2026-05-01', amount: 300 },
  { id: 2, date: '2026-05-15', amount: 100 },
  { id: 3, date: '2026-05-03', amount: 200 },
];

describe('useSortedRows — date sorting', () => {
  it('sorts by date ascending CHRONOLOGICALLY (not by year/id)', () => {
    const { result } = renderHook(() => useSortedRows(rows));
    act(() => result.current.setSort('date', 'asc'));
    expect(result.current.sortedRows.map((r) => r.date)).toEqual(['2026-05-01', '2026-05-03', '2026-05-15']);
  });

  it('sorts by date descending', () => {
    const { result } = renderHook(() => useSortedRows(rows));
    act(() => result.current.setSort('date', 'desc'));
    expect(result.current.sortedRows.map((r) => r.date)).toEqual(['2026-05-15', '2026-05-03', '2026-05-01']);
  });

  it('still sorts numeric fields numerically', () => {
    const { result } = renderHook(() => useSortedRows(rows));
    act(() => result.current.setSort('amount', 'asc'));
    expect(result.current.sortedRows.map((r) => r.amount)).toEqual([100, 200, 300]);
  });
});
