'use client';

// Always-visible sort control for list pages — works on BOTH mobile and
// desktop (the desktop column-header click-sort isn't available in the mobile
// card view, so this is the universal way to sort). Drives useSortedRows via
// setSort: a field <select> + an asc/desc toggle. Switching field keeps the
// current direction; the toggle flips it. Default direction is desc.
//
// Usage:
//   const { sortConfig, setSort, ... } = useSortedRows(rows, { key:'date', direction:'desc' });
//   <SortControl fields={[{ key:'date', label:'التاريخ' }, ...]} sortConfig={sortConfig} setSort={setSort} />
export default function SortControl({ fields, sortConfig, setSort }) {
  if (!fields || fields.length === 0) return null;
  const key = sortConfig?.key || fields[0].key;
  const dir = sortConfig?.direction || 'desc';
  return (
    <div className="sort-control">
      <span className="sort-control-label">ترتيب حسب</span>
      <select
        className="filter-control"
        value={key}
        onChange={(e) => setSort(e.target.value, dir)}
        aria-label="ترتيب حسب"
      >
        {fields.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm btn-outline sort-control-dir"
        onClick={() => setSort(key, dir === 'asc' ? 'desc' : 'asc')}
        aria-label={dir === 'asc' ? 'ترتيب تصاعدي — اضغط للتنازلي' : 'ترتيب تنازلي — اضغط للتصاعدي'}
      >
        {dir === 'asc' ? '↑ تصاعدي' : '↓ تنازلي'}
      </button>
    </div>
  );
}
