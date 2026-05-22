'use client';

import { useState, useEffect } from 'react';

// Commit 3 — mobile filter sheet (view-only wrapper; NO filter logic here).
//
// Wraps a page's EXISTING filter controls. It owns only open/close UI state —
// the controls inside still call the page's own useUrlFilters set()/reset(), so
// filtering stays live and identical; URL + API behaviour are untouched.
//
// Desktop (≥768px): the wrapper is a pure passthrough (display:contents in
// globals.css) — the page's filter bar renders exactly where and how it did.
// Mobile (<768px): the inline controls are hidden behind a compact "فلترة (n)"
// trigger + removable active-filter chips; tapping opens a bottom sheet that
// hosts the SAME controls (rendered once — no duplicate DOM/ids) with
// مسح / تطبيق in the footer ("تطبيق" just closes; the result already updated).
//
// Props:
//   children   — the page's existing filter inputs/selects (rendered as-is)
//   chips      — [{ label, onRemove }] active filters shown on the trigger row
//   isActive   — whether any filter differs from its default (from useUrlFilters)
//   onClear    — reset() from useUrlFilters
//   title      — sheet heading (default: 'الفلاتر')
export default function FilterSheet({ children, chips = [], isActive = false, onClear, title = 'الفلاتر' }) {
  const [open, setOpen] = useState(false);
  const count = chips.length;

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className={`filter-sheet ${open ? 'open' : ''}`}>
      {/* Mobile-only trigger row (hidden on desktop) */}
      <div className="filter-sheet-trigger-row">
        <button type="button" className="filter-sheet-open-btn" onClick={() => setOpen(true)} aria-label="فتح الفلاتر">
          <span aria-hidden="true">⚙</span> فلترة{count ? ` (${count})` : ''}
        </button>
        {chips.length > 0 && (
          <div className="filter-chips">
            {chips.map((c, i) => (
              <button key={i} type="button" className="chip active" onClick={c.onRemove} aria-label={`إزالة الفلتر: ${c.label}`}>
                {c.label} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile-only backdrop (shown when open) */}
      <div className="filter-sheet-backdrop" onClick={() => setOpen(false)} />

      {/* Controls: inline on desktop; bottom-sheet body on mobile when open */}
      <div className="filter-sheet-controls" role="group" aria-label={title}>
        <div className="filter-sheet-header">
          <span>{title}</span>
          <button type="button" className="filter-sheet-close" aria-label="إغلاق" onClick={() => setOpen(false)}>✕</button>
        </div>
        {children}
        <div className="filter-sheet-footer">
          {onClear && (
            <button type="button" className="btn btn-sm" style={{ background: '#e2e8f0', color: '#334155' }} onClick={onClear} disabled={!isActive}>
              مسح
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(false)}>تطبيق</button>
        </div>
      </div>
    </div>
  );
}
