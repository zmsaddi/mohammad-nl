'use client';

// v1.1 S3.7 — skeleton loader for data-heavy pages.
//
// Renders animated placeholder blocks that roughly match the page layout:
// a stats row + a table-like card with shimmer lines. Replaces the
// full-page spinner that caused a "white flash" on slow networks
// (study Domain 2 audit: every data page used a spinner-only loading
// state with no skeleton).
//
// Usage:
//   if (loading) return <AppLayout><PageSkeleton rows={6} /></AppLayout>;

export default function PageSkeleton({ rows = 5, showStats = true }) {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="جاري التحميل">
      {/* Stats row skeleton */}
      {showStats && (
        <div className="skeleton-stats">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-stat-card">
              <div className="skeleton-line skeleton-line-short" />
              <div className="skeleton-line skeleton-line-wide" />
            </div>
          ))}
        </div>
      )}

      {/* Table/card skeleton */}
      <div className="skeleton-card">
        <div className="skeleton-line skeleton-line-title" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton-line skeleton-line-cell" />
            <div className="skeleton-line skeleton-line-cell" />
            <div className="skeleton-line skeleton-line-cell-short" />
          </div>
        ))}
      </div>
    </div>
  );
}
