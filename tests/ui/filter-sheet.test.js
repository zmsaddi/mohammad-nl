// @vitest-environment jsdom
//
// FilterSheet is now a pure inline passthrough (the mobile bottom-sheet was
// removed per user feedback — filters are always visible). These tests pin that
// it renders its children and adds no trigger/sheet chrome, even when the
// legacy chips/isActive/onClear props are still passed by pages.
import './_setup-ui.js';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FilterSheet from '../../components/FilterSheet.js';

describe('FilterSheet (inline passthrough)', () => {
  it('renders its children inline, exactly once', () => {
    render(
      <FilterSheet>
        <input aria-label="بحث" />
      </FilterSheet>
    );
    expect(screen.getAllByLabelText('بحث')).toHaveLength(1);
  });

  it('adds no bottom-sheet trigger or footer, even with legacy props', () => {
    render(
      <FilterSheet chips={[{ label: 'مبيعات', onRemove: () => {} }]} isActive onClear={() => {}}>
        <span>محتوى</span>
      </FilterSheet>
    );
    expect(screen.getByText('محتوى')).toBeInTheDocument();
    expect(screen.queryByLabelText('فتح الفلاتر')).not.toBeInTheDocument();
    expect(screen.queryByText('تطبيق')).not.toBeInTheDocument();
  });
});
