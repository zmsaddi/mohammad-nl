// @vitest-environment jsdom
//
// Page-level SMOKE test for the invoices list — the Commit 1 reference page and
// a Commit 2 target (its `catch → setInvoices([])` will become an explicit
// error state). This proves the whole page tree (AppLayout + Sidebar +
// useUrlFilters + DataCardList + table + Pagination + modals) mounts and
// renders fetched data without crashing. Auth / navigation / fetch / Link are
// mocked so no server or session is required.
import './_setup-ui.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/invoices',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin', name: 'مدير' } }, status: 'authenticated' }),
  signOut: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }) => <a href={typeof href === 'string' ? href : '#'}>{children}</a>,
}));

import InvoicesPage from '../../app/invoices/page.js';

const SAMPLE = [{
  id: 1, ref_code: 'INV-0001', date: '2026-05-01', client_name: 'أحمد المصري',
  item: 'دراجة كهربائية', quantity: 1, total: 1500, unit_price: 1500,
  payment_type: 'كاش', vin: 'VIN-123', seller_name: 'بائع', driver_name: null,
}];

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => SAMPLE }));
});

describe('InvoicesPage (smoke)', () => {
  it('renders the page shell and fetched rows', async () => {
    render(<InvoicesPage />);
    // page header is present (appears in the header + the card title)
    expect(screen.getAllByText(/الفواتير/).length).toBeGreaterThan(0);
    // data arrives asynchronously; row appears in both the card + table views
    const refs = await screen.findAllByText('INV-0001');
    expect(refs.length).toBeGreaterThan(0);
    expect(screen.getAllByText('أحمد المصري').length).toBeGreaterThan(0);
    // fetch was called against the invoices API
    expect(global.fetch).toHaveBeenCalledWith('/api/invoices', expect.objectContaining({ cache: 'no-store' }));
  });

  it('shows the no-data empty state when the API returns an empty list', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
    render(<InvoicesPage />);
    expect(await screen.findByText('لا توجد فواتير بعد')).toBeInTheDocument();
  });
});
