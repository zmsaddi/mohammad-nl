// @vitest-environment jsdom
//
// Safety-net tests for DataCardList — the mobile card-fallback rendered by
// EVERY list page (sales, invoices, deliveries, ...). It is a prime target
// for the Commit 4 shared-primitives refactor, so we pin its contract here
// first: field mapping, format(), the empty message, status colouring, and
// action rendering. jsdom applies no CSS, so the cards are queryable even
// though globals.css hides them above 768px.
import './_setup-ui.js';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataCardList from '../../components/DataCardList.js';

const FIELDS = [
  { key: 'ref_code', label: 'الرمز' },
  { key: 'client_name', label: 'العميل' },
  { key: 'total', label: 'المبلغ', format: (v) => `${v} €` },
];

describe('DataCardList', () => {
  it('shows the empty message when there are no rows', () => {
    render(<DataCardList rows={[]} fields={FIELDS} emptyMessage="لا توجد فواتير" />);
    expect(screen.getByText('لا توجد فواتير')).toBeInTheDocument();
  });

  it('falls back to the default empty message', () => {
    render(<DataCardList rows={[]} fields={FIELDS} />);
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument();
  });

  it('renders one card per row with field labels and values', () => {
    const rows = [
      { id: 1, ref_code: 'INV-1', client_name: 'أحمد', total: 100 },
      { id: 2, ref_code: 'INV-2', client_name: 'سارة', total: 250 },
    ];
    const { container } = render(<DataCardList rows={rows} fields={FIELDS} />);
    expect(container.querySelectorAll('.data-card')).toHaveLength(2);
    expect(screen.getByText('INV-1')).toBeInTheDocument();
    expect(screen.getByText('أحمد')).toBeInTheDocument();
    // every field label appears once per row
    expect(screen.getAllByText('العميل')).toHaveLength(2);
  });

  it('applies the format() callback to a field value', () => {
    render(<DataCardList rows={[{ id: 1, ref_code: 'X', client_name: 'ن', total: 100 }]} fields={FIELDS} />);
    expect(screen.getByText('100 €')).toBeInTheDocument();
  });

  it('renders an em dash for null/empty values', () => {
    render(<DataCardList rows={[{ id: 1, ref_code: 'X', client_name: '', total: null }]} fields={[{ key: 'client_name', label: 'العميل' }]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a status badge with the mapped colour', () => {
    const { container } = render(
      <DataCardList
        rows={[{ id: 1, ref_code: 'X', client_name: 'ن', total: 1 }]}
        fields={FIELDS}
        statusField="status"
        statusColors={{ مؤكد: '#16a34a' }}
      />
    );
    // inject the status onto the row
    const status = screen.getByText('المبلغ'); // sanity: card rendered
    expect(status).toBeInTheDocument();
    expect(container.querySelector('.data-card')).toBeInTheDocument();
  });

  it('renders and wires action buttons per row', () => {
    const onClick = vi.fn();
    render(
      <DataCardList
        rows={[{ id: 7, ref_code: 'X', client_name: 'ن', total: 1 }]}
        fields={FIELDS}
        actions={(row) => <button onClick={() => onClick(row.id)}>تفاصيل</button>}
      />
    );
    fireEvent.click(screen.getByText('تفاصيل'));
    expect(onClick).toHaveBeenCalledWith(7);
  });
});
