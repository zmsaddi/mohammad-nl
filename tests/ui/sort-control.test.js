// @vitest-environment jsdom
//
// SortControl is the always-visible sort UI for list pages (works on mobile,
// where the desktop column-header sort isn't available, and on desktop).
import './_setup-ui.js';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SortControl from '../../components/SortControl.js';

const fields = [{ key: 'date', label: 'التاريخ' }, { key: 'total', label: 'الإجمالي' }];

describe('SortControl', () => {
  it('reflects the current field + direction', () => {
    render(<SortControl fields={fields} sortConfig={{ key: 'date', direction: 'desc' }} setSort={() => {}} />);
    expect(screen.getByLabelText('ترتيب حسب')).toHaveValue('date');
    expect(screen.getByText('↓ تنازلي')).toBeInTheDocument();
  });

  it('changing the field calls setSort(key, sameDirection)', () => {
    const setSort = vi.fn();
    render(<SortControl fields={fields} sortConfig={{ key: 'date', direction: 'desc' }} setSort={setSort} />);
    fireEvent.change(screen.getByLabelText('ترتيب حسب'), { target: { value: 'total' } });
    expect(setSort).toHaveBeenCalledWith('total', 'desc');
  });

  it('the toggle flips the direction for the current field', () => {
    const setSort = vi.fn();
    render(<SortControl fields={fields} sortConfig={{ key: 'date', direction: 'desc' }} setSort={setSort} />);
    fireEvent.click(screen.getByText('↓ تنازلي'));
    expect(setSort).toHaveBeenCalledWith('date', 'asc');
  });

  it('renders nothing when given no fields', () => {
    const { container } = render(<SortControl fields={[]} sortConfig={{}} setSort={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
