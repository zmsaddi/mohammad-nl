'use client';

import { useState, useMemo } from 'react';

export function usePagination(rows, defaultPerPage = 25) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(defaultPerPage);

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(page, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return rows.slice(start, start + perPage);
  }, [rows, safePage, perPage]);

  const goTo = (p) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  return { paginatedRows, page: safePage, totalPages, perPage, setPerPage: (v) => { setPerPage(v); setPage(1); }, goTo, resetPage, totalRows: rows.length };
}

export default function Pagination({ page, totalPages, totalRows, perPage, onPageChange, onPerPageChange }) {
  if (totalRows <= 10) return null;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="pagination">
      <div className="pagination-info">
        {totalRows} سجل — صفحة {page} من {totalPages}
      </div>
      <div className="pagination-controls">
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPageChange(1)} aria-label="الصفحة الأولى">&laquo;</button>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="السابق">&lsaquo;</button>
        {start > 1 && <span className="pagination-ellipsis">...</span>}
        {pages.map((p) => (
          <button key={p} className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-outline'}`} onClick={() => onPageChange(p)}>
            {p}
          </button>
        ))}
        {end < totalPages && <span className="pagination-ellipsis">...</span>}
        <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="التالي">&rsaquo;</button>
        <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} aria-label="الصفحة الأخيرة">&raquo;</button>
      </div>
      {onPerPageChange && (
        <select className="pagination-per-page" value={perPage} onChange={(e) => onPerPageChange(Number(e.target.value))}>
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      )}
    </div>
  );
}
