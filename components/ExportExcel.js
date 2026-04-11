'use client';

import * as XLSX from 'xlsx';

export default function ExportExcel({ data, fileName, sheetName = 'البيانات' }) {
  const handleExport = () => {
    if (!data || data.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Auto-width columns
    const colWidths = Object.keys(data[0]).map((key) => ({
      wch: Math.max(
        key.length * 2,
        ...data.map((row) => String(row[key] || '').length * 1.5)
      ),
    }));
    ws['!cols'] = colWidths;

    // Set RTL
    ws['!dir'] = 'rtl';

    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  return (
    <button className="btn btn-success btn-sm" onClick={handleExport}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      تحميل Excel
    </button>
  );
}
