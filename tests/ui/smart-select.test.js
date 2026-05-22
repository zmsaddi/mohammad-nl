// @vitest-environment jsdom
//
// Safety-net for SmartSelect — the typeahead used in the sale + purchase forms
// (client / supplier / product), including its "create new" path which is wired
// to real create-entity logic. Pins: filtering, selecting an option, the
// allow-new affordance, and keyboard select. StatusBadge (used in every table)
// is pinned here too as a cheap presentational guard.
import './_setup-ui.js';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SmartSelect from '../../components/SmartSelect.js';
import StatusBadge from '../../components/StatusBadge.js';

describe('SmartSelect', () => {
  const options = ['أحمد', 'سارة', 'محمود'];

  it('renders the placeholder and opens the list on focus', () => {
    render(<SmartSelect value="" onChange={() => {}} options={options} placeholder="اكتب اسم العميل" />);
    const input = screen.getByPlaceholderText('اكتب اسم العميل');
    fireEvent.focus(input);
    expect(screen.getByText('سارة')).toBeInTheDocument();
  });

  it('filters options as the user types', () => {
    render(<SmartSelect value="" onChange={() => {}} options={options} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'سا' } });
    expect(screen.getByText('سارة')).toBeInTheDocument();
    expect(screen.queryByText('محمود')).not.toBeInTheDocument();
  });

  it('selecting an option fires onChange with its value', () => {
    const onChange = vi.fn();
    render(<SmartSelect value="" onChange={onChange} options={options} />);
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.click(screen.getByText('أحمد'));
    expect(onChange).toHaveBeenCalledWith('أحمد', 'أحمد');
  });

  it('offers a create-new row when the typed value is not an option', () => {
    const onChange = vi.fn();
    render(<SmartSelect value="" onChange={onChange} options={options} allowNew newLabel="إضافة عميل" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'خالد' } });
    const addRow = screen.getByText(/إضافة عميل/);
    expect(addRow).toBeInTheDocument();
    fireEvent.click(addRow);
    expect(onChange).toHaveBeenLastCalledWith('خالد');
  });

  it('supports object options with value/label and keyboard select', () => {
    const onChange = vi.fn();
    const objOpts = [{ label: 'منتج أ', value: 'A', sub: 'كود A' }, { label: 'منتج ب', value: 'B' }];
    render(<SmartSelect value="" onChange={onChange} options={objOpts} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('A', objOpts[0]);
  });
});

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="مؤكد" />);
    expect(screen.getByText('مؤكد')).toBeInTheDocument();
  });

  it('falls back to a neutral style for unknown statuses', () => {
    const { container } = render(<StatusBadge status="حالة-غير-معروفة" />);
    const badge = container.querySelector('.status-badge');
    expect(badge).toHaveStyle({ background: '#f1f5f9' });
  });
});
