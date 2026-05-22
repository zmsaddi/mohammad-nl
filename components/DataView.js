'use client';

// DataView — the single, MOBILE-FIRST renderer for every list page.
//
// One `columns` spec produces BOTH layouts:
//   • Mobile (base/default): a stacked card list — always fits the screen, NO
//     horizontal scroll, ever. This is the primary rendering.
//   • Desktop (≥768px): a table, shown only as a progressive enhancement via the
//     existing `.table-container.has-card-fallback` CSS.
//
// Why: previously every page hand-wrote the column layout TWICE — once as a
// <DataCardList> (mobile) and once as a <table> (desktop). That duplication is
// what made pages drift: some forgot the card fallback and shipped a table that
// scrolls sideways on mobile (hiding columns). With DataView a page declares its
// columns once, so the two layouts can never disagree and a mobile
// horizontal-scroll table can't happen by construction.
//
// columns: [{
//   key,                        // row property key (also the React key)
//   label,                      // header text + mobile card label
//   cell?: (row) => ReactNode,  // desktop-table custom render; else row[key]
//   mobileCell?: (row) => ReactNode, // mobile-card render when it must DIFFER from
//                               // the desktop cell (e.g. desktop shows an edit
//                               // input, mobile shows a read-only value). Falls
//                               // back to `cell` then row[key]. Use it to keep
//                               // exact parity with pages whose mobile layout was
//                               // display-only while the desktop was editable.
//   align?: 'end',              // numeric columns → right-aligned `.number-cell`
//   sortable?: boolean,         // clickable sort header (requires the `sort` prop)
//   mobileHide?: boolean,       // omit this column from the mobile card
// }]
// rows
// actions?: (row) => ReactNode  // per-row buttons (table last column + card actions)
// onRowClick?: (row) => void    // makes the row/card clickable (e.g. open details)
// sort?: object                 // the useSortedRows() return — needs requestSort,
//                               // getAriaSort, getSortIndicator
// rowKey?: (row, i) => key      // defaults to row.id ?? index
// emptyMessage

export default function DataView({
  rows,
  columns,
  actions,
  onRowClick,
  sort,
  rowKey,
  emptyMessage = 'لا توجد بيانات',
}) {
  const keyOf = (row, i) => (rowKey ? rowKey(row, i) : (row?.id ?? i));
  const renderCell = (col, row) => {
    if (col.cell) return col.cell(row);
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

  return (
    <>
      {/* Mobile-first base layout: stacked cards (visible < 768px) */}
      <div className="data-card-list">
        {rows.map((row, i) => (
          <div
            key={keyOf(row, i)}
            className={`data-card${onRowClick ? ' data-card-clickable' : ''}`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            <div className="data-card-fields">
              {columns.filter((c) => !c.mobileHide).map((col) => (
                <div key={col.key} className="data-card-field">
                  <span className="data-card-label">{col.label}</span>
                  <span className="data-card-value">{col.mobileCell ? col.mobileCell(row) : renderCell(col, row)}</span>
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

      {/* Desktop enhancement: the table (visible ≥ 768px, hidden on mobile) */}
      <div className="table-container has-card-fallback">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => {
                const sortable = col.sortable && sort;
                return (
                  <th
                    key={col.key}
                    onClick={sortable ? () => sort.requestSort(col.key) : undefined}
                    aria-sort={sortable ? sort.getAriaSort(col.key) : undefined}
                    style={sortable ? { cursor: 'pointer' } : undefined}
                  >
                    {col.label}{sortable ? sort.getSortIndicator(col.key) : ''}
                  </th>
                );
              })}
              {actions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                className={onRowClick ? 'clickable-row' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.align === 'end' ? 'number-cell' : undefined}>
                    {renderCell(col, row)}
                  </td>
                ))}
                {actions && (
                  <td onClick={(e) => e.stopPropagation()}>{actions(row)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
