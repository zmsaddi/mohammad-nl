'use client';

// DataView — the single CARD renderer for every list page, on ALL screens.
//
// One `columns` spec renders a card list that works on phone AND desktop:
//   • Phone: one column of stacked cards — always fits, never scrolls sideways.
//   • Desktop: the SAME cards in a responsive grid (several per row) — so the
//     desktop no longer shows wide, long-line tables. See `.data-card-list` in
//     globals.css for the grid.
//
// Why no table: every page used to hand-write the columns TWICE (a card list +
// a <table>), which drifted and produced sideways-scrolling tables. The wide
// desktop tables were also hard to read (very long rows). Cards everywhere fix
// both: one declaration, one consistent layout, no horizontal scroll.
//
// Sorting is the page's shared <SortControl> select (visible on every screen);
// there are no table headers to click anymore.
//
// columns: [{
//   key,                        // row property key (also the React key)
//   label,                      // card field label
//   cell?: (row) => ReactNode,  // custom render; else mobileCell, else row[key]
//   mobileCell?: (row) => ReactNode, // read-only fallback used only when there is
//                               // no `cell` (legacy hook; `cell` is preferred).
//   align?: 'end',              // (numeric hint — kept for compatibility)
//   sortable?: boolean,         // (kept for compatibility; sorting is via SortControl)
//   mobileHide?: boolean,       // DESKTOP-ONLY column: shown on the wide card,
//                               // hidden on the compact phone card.
// }]
// rows
// actions?: (row) => ReactNode  // per-row buttons (card actions row)
// onRowClick?: (row) => void    // makes the card clickable (e.g. open details)
// rowKey?: (row, i) => key      // defaults to row.id ?? index
// emptyMessage

export default function DataView({
  rows,
  columns,
  actions,
  onRowClick,
  rowKey,
  emptyMessage = 'لا توجد بيانات',
}) {
  const keyOf = (row, i) => (rowKey ? rowKey(row, i) : (row?.id ?? i));
  // Card value: prefer the rich `cell` (full/editable), fall back to the
  // read-only `mobileCell`, then the raw field. The page sorts via the
  // shared <SortControl> select (shown on every screen), so the old table
  // header `sort` prop is no longer used here.
  const renderCell = (col, row) => {
    if (col.cell) return col.cell(row);
    if (col.mobileCell) return col.mobileCell(row);
    const v = row[col.key];
    return v != null && v !== '' ? String(v) : '—';
  };

  if (!rows || rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
        {emptyMessage}
      </div>
    );
  }

  // Cards on every screen size: one column on the phone, a responsive grid on
  // desktop (see .data-card-list in globals.css). Columns flagged `mobileHide`
  // are desktop-only — they render on the wider card but stay off the compact
  // phone card via the .dv-desktop-field class.
  return (
    <div className="data-card-list">
      {rows.map((row, i) => (
        <div
          key={keyOf(row, i)}
          className={`data-card${onRowClick ? ' data-card-clickable' : ''}`}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
        >
          <div className="data-card-fields">
            {columns.map((col) => (
              <div key={col.key} className={`data-card-field${col.mobileHide ? ' dv-desktop-field' : ''}`}>
                <span className="data-card-label">{col.label}</span>
                <div className="data-card-value">{renderCell(col, row)}</div>
              </div>
            ))}
          </div>
          {actions && (
            <div className="data-card-actions" onClick={(e) => e.stopPropagation()}>
              {actions(row)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
