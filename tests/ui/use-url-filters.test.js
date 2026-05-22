// @vitest-environment jsdom
//
// Keystone safety-net test. useUrlFilters is the shared state engine behind
// EVERY list page's filters, and Commit 3 (mobile filter sheet) + Commit 4
// (FilterBar primitive) will both build on top of it. Pinning its contract —
// URL seeding, set/reset, default-elision, isActive — guards those refactors.
//
// The next/navigation mock is backed by REAL jsdom history so that the hook's
// internal `window.location.search` reads (writeUrl) and useSearchParams stay
// consistent, exactly as in the browser.
import './_setup-ui.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { replaceSpy } = vi.hoisted(() => ({ replaceSpy: vi.fn() }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({
    replace: (url) => { replaceSpy(url); window.history.replaceState({}, '', url); },
  }),
}));

import { useUrlFilters } from '../../lib/use-url-filters.js';

// Stable spec (module constant) as the hook documents it must be.
const SPEC = { q: { default: '', debounce: 0 }, status: { default: 'all' } };

beforeEach(() => {
  window.history.replaceState({}, '', '/test');
  replaceSpy.mockClear();
});

describe('useUrlFilters', () => {
  it('seeds defaults when the URL has no params', () => {
    const { result } = renderHook(() => useUrlFilters(SPEC));
    expect(result.current.values).toEqual({ q: '', status: 'all' });
    expect(result.current.isActive).toBe(false);
  });

  it('seeds values from the URL (shareable / refresh-safe)', () => {
    window.history.replaceState({}, '', '/test?q=ahmad&status=paid');
    const { result } = renderHook(() => useUrlFilters(SPEC));
    expect(result.current.values).toEqual({ q: 'ahmad', status: 'paid' });
    expect(result.current.isActive).toBe(true);
  });

  it('set() updates the value and writes a non-default key to the URL', () => {
    const { result } = renderHook(() => useUrlFilters(SPEC));
    act(() => result.current.set('status', 'paid'));
    expect(result.current.values.status).toBe('paid');
    expect(result.current.isActive).toBe(true);
    expect(replaceSpy.mock.calls.at(-1)[0]).toContain('status=paid');
  });

  it('set() back to default removes the key from the URL', () => {
    window.history.replaceState({}, '', '/test?status=paid');
    const { result } = renderHook(() => useUrlFilters(SPEC));
    act(() => result.current.set('status', 'all'));
    expect(result.current.values.status).toBe('all');
    expect(replaceSpy.mock.calls.at(-1)[0]).not.toContain('status=');
  });

  it('set(object) applies an atomic multi-key update', () => {
    const { result } = renderHook(() => useUrlFilters(SPEC));
    act(() => result.current.set({ q: 'a', status: 'paid' }));
    expect(result.current.values).toEqual({ q: 'a', status: 'paid' });
  });

  it('reset() clears every key back to its default', () => {
    window.history.replaceState({}, '', '/test?q=x&status=paid');
    const { result } = renderHook(() => useUrlFilters(SPEC));
    act(() => result.current.reset());
    expect(result.current.values).toEqual({ q: '', status: 'all' });
    expect(result.current.isActive).toBe(false);
  });

  it('preserves unrelated query params (e.g. ?new=1) when writing', () => {
    window.history.replaceState({}, '', '/test?new=1');
    const { result } = renderHook(() => useUrlFilters(SPEC));
    act(() => result.current.set('status', 'paid'));
    const url = replaceSpy.mock.calls.at(-1)[0];
    expect(url).toContain('new=1');
    expect(url).toContain('status=paid');
  });
});
