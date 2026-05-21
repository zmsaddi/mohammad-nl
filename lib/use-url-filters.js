'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

// One shared filter-state hook for every list page. State is seeded from the
// URL (refresh-safe + shareable links), and writes back to the URL via
// router.replace (not push — filter tweaks aren't navigation, so they don't
// spam the back button). Generalizes the pattern proven on the sales page.
//
// spec: { [key]: { default, debounce? } }
//   default  — the "absent from URL" value ('all' for selects, '' for text/date)
//   debounce — ms to wait before writing this key to the URL (text inputs);
//              the returned `values` updates instantly for snappy filtering.
//
// Returns { values, set, reset, isActive }:
//   values[key]    — current value (instant)
//   set(key, val)  — update one key; set(patchObject) — atomic multi-key update
//   reset()        — clear all spec keys in ONE replace
//   isActive       — any key differs from its default (drives the "✕ مسح" button)
//
// IMPORTANT: pass a STABLE `spec` (module constant or useMemo) — a fresh object
// each render would churn the memoized callbacks. The page that uses this MUST
// be wrapped in <Suspense> (useSearchParams requires it for prerender).
export function useUrlFilters(spec) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Seed local state from the URL once (shareable + survives refresh).
  const [values, setValues] = useState(() => {
    const init = {};
    for (const key in spec) init[key] = searchParams.get(key) ?? spec[key].default;
    return init;
  });

  // Mirror current values in a ref so set() can compute the next state
  // synchronously without nesting URL side-effects in the state updater. The
  // ref is seeded once and kept current by set()/reset() (the only mutators),
  // so it must NOT be written during render.
  const valuesRef = useRef(values);
  const timers = useRef({});

  const writeUrl = useCallback((next) => {
    // Read the live query string so unrelated params (e.g. ?new=1) are preserved.
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    let changed = false;
    for (const key in spec) {
      const def = spec[key].default;
      const v = next[key];
      if (v == null || v === '' || v === def) {
        if (params.has(key)) { params.delete(key); changed = true; }
      } else if (params.get(key) !== String(v)) {
        params.set(key, String(v)); changed = true;
      }
    }
    if (!changed) return; // no-op guard — avoids history noise / render loops
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [spec, router, pathname]);

  const set = useCallback((key, val) => {
    const next = (typeof key === 'object' && key !== null)
      ? { ...valuesRef.current, ...key }
      : { ...valuesRef.current, [key]: val };
    valuesRef.current = next;
    setValues(next);
    const debounceMs = (typeof key === 'string') ? spec[key]?.debounce : 0;
    if (debounceMs) {
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => writeUrl(valuesRef.current), debounceMs);
    } else {
      writeUrl(next);
    }
  }, [spec, writeUrl]);

  const reset = useCallback(() => {
    const cleared = {};
    for (const key in spec) cleared[key] = spec[key].default;
    valuesRef.current = cleared;
    setValues(cleared);
    Object.values(timers.current).forEach(clearTimeout);
    writeUrl(cleared);
  }, [spec, writeUrl]);

  // Clear pending debounce timers on unmount.
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const isActive = Object.keys(spec).some((k) => values[k] !== spec[k].default);

  return { values, set, reset, isActive };
}
