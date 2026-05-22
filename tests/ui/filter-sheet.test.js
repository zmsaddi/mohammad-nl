// @vitest-environment jsdom
//
// Safety-net for the Commit 3 FilterSheet wrapper. jsdom applies no CSS, so
// every element is in the DOM regardless of breakpoint; we assert the open/close
// state machine, that children render once, chip removal, and clear/apply wiring.
import './_setup-ui.js';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterSheet from '../../components/FilterSheet.js';

describe('FilterSheet', () => {
  it('renders the child controls exactly once (no duplicate DOM)', () => {
    render(
      <FilterSheet>
        <input aria-label="بحث" />
      </FilterSheet>
    );
    expect(screen.getAllByLabelText('بحث')).toHaveLength(1);
  });

  it('opens and closes via the trigger / close / apply controls', () => {
    const { container } = render(<FilterSheet><span>محتوى</span></FilterSheet>);
    const sheet = container.querySelector('.filter-sheet');
    expect(sheet.className).not.toContain('open');

    fireEvent.click(screen.getByLabelText('فتح الفلاتر'));
    expect(sheet.className).toContain('open');

    fireEvent.click(screen.getByText('تطبيق'));
    expect(sheet.className).not.toContain('open');

    // re-open then close via the ✕ header button
    fireEvent.click(screen.getByLabelText('فتح الفلاتر'));
    fireEvent.click(screen.getByLabelText('إغلاق'));
    expect(sheet.className).not.toContain('open');
  });

  it('shows the active-filter count and removable chips', () => {
    const onRemove = vi.fn();
    render(
      <FilterSheet chips={[{ label: 'مبيعات', onRemove }, { label: 'آجل', onRemove: () => {} }]}>
        <span>x</span>
      </FilterSheet>
    );
    expect(screen.getByLabelText('فتح الفلاتر')).toHaveTextContent('فلترة (2)');
    fireEvent.click(screen.getByLabelText('إزالة الفلتر: مبيعات'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('wires Clear to onClear and disables it when no filter is active', () => {
    const onClear = vi.fn();
    const { rerender } = render(<FilterSheet isActive={false} onClear={onClear}><span>x</span></FilterSheet>);
    expect(screen.getByText('مسح')).toBeDisabled();
    rerender(<FilterSheet isActive={true} onClear={onClear}><span>x</span></FilterSheet>);
    fireEvent.click(screen.getByText('مسح'));
    expect(onClear).toHaveBeenCalled();
  });
});
