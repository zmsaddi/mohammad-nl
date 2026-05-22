// @vitest-environment jsdom
//
// Safety-net for the usePagination hook + Pagination component, shared by all
// list pages. Pins the slicing math, the "hide below 11 rows" rule, page
// clamping, and that changing page size resets to page 1.
import './_setup-ui.js';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import Pagination, { usePagination } from '../../components/Pagination.js';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe('usePagination', () => {
  it('slices the first page by perPage and reports totals', () => {
    const { result } = renderHook(() => usePagination(rows(30)));
    expect(result.current.perPage).toBe(25);
    expect(result.current.paginatedRows).toHaveLength(25);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.totalRows).toBe(30);
  });

  it('goTo() moves to a page and clamps out-of-range requests', () => {
    const { result } = renderHook(() => usePagination(rows(30)));
    act(() => result.current.goTo(2));
    expect(result.current.page).toBe(2);
    expect(result.current.paginatedRows).toHaveLength(5);
    act(() => result.current.goTo(99));
    expect(result.current.page).toBe(2); // clamped to last page
  });

  it('setPerPage() changes the page size and resets to page 1', () => {
    const { result } = renderHook(() => usePagination(rows(30)));
    act(() => result.current.goTo(2));
    act(() => result.current.setPerPage(10));
    expect(result.current.perPage).toBe(10);
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
  });
});

describe('Pagination component', () => {
  it('renders nothing for 10 rows or fewer', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} totalRows={10} perPage={25} onPageChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders controls and fires onPageChange', () => {
    const onPageChange = vi.fn();
    render(
      <Pagination page={1} totalPages={2} totalRows={30} perPage={25} onPageChange={onPageChange} />
    );
    expect(screen.getByText(/30 سجل/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('التالي'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables previous controls on the first page', () => {
    render(
      <Pagination page={1} totalPages={2} totalRows={30} perPage={25} onPageChange={() => {}} />
    );
    expect(screen.getByLabelText('السابق')).toBeDisabled();
    expect(screen.getByLabelText('التالي')).not.toBeDisabled();
  });
});
