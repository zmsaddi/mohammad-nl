'use client';

import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';

const DEFAULT_INTERVAL = 60000; // v1.2 bumped 30s→60s: less aggressive polling
const INTERACTION_GRACE_MS = 8000; // skip tick for 8s after any user input/click

// v1.2 — three-layer guard added to stop auto-refresh from stealing focus
// and dismissing in-flight work. Reported in production:
//   (1) Delivery confirmation modal appeared to close mid-typing
//   (2) VIN input lost focus on each keystroke
//   (3) Pages "reloaded" every 30s disrupting general workflow
// All three trace back to fetchFn running mid-interaction → parent re-render
// → React reconciles the controlled input, but the on-screen selection/
// keyboard state gets clobbered on some browsers, and any open modal flickers
// while its parent's data props change.
//
// Guards (all must pass or the tick is skipped):
//   1. Page tab is visible (existing)
//   2. No modal overlay is currently mounted (`.modal-overlay` selector —
//      every modal across the app uses this class)
//   3. Active element is not an input/textarea/select (user isn't typing)
//   4. Last user interaction is older than INTERACTION_GRACE_MS
//      (covers rapid keystrokes + brief defocus windows)
//
// Skipped ticks are silent — the interval keeps running, so the moment the
// user finishes interacting (closes modal, defocuses the field, stops typing),
// the next tick fires on schedule. No lag, no lost refreshes.
export function useAutoRefresh(fetchFn, intervalMs = DEFAULT_INTERVAL) {
  const intervalRef = useRef(null);
  const fetchRef = useRef(fetchFn);
  const visibleRef = useRef(true);
  const lastInteractionRef = useRef(0);

  // Sync the ref with the latest fetchFn AFTER each render but BEFORE paint.
  // useLayoutEffect (vs useEffect) closes the race window where an in-flight
  // interval tick could read a stale closure between commit and paint. The
  // hook is consumed by 16 pages — using the wrong primitive here would be
  // a wide-surface regression.
  useLayoutEffect(() => {
    fetchRef.current = fetchFn;
  });

  const shouldSkip = useCallback(() => {
    if (!visibleRef.current) return true;
    if (typeof document === 'undefined') return true;

    // Any modal open? Dashboard modals all use `.modal-overlay`.
    if (document.querySelector('.modal-overlay')) return true;

    // User typing or focused in a form control?
    const active = document.activeElement;
    if (active) {
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (active.isContentEditable) return true;
    }

    // Recent keystroke/click? 8-second grace so refresh doesn't race
    // with mid-flow clicks (e.g., driver tapping "confirm" after typing).
    if (Date.now() - lastInteractionRef.current < INTERACTION_GRACE_MS) return true;

    return false;
  }, []);

  const tick = useCallback(() => {
    if (shouldSkip()) return;
    fetchRef.current();
  }, [shouldSkip]);

  useEffect(() => {
    const handleVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
      if (visibleRef.current) tick();
    };

    const markInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    // Passive listeners — cheap to attach; these events fire a lot but we
    // only write a timestamp, no DOM work.
    document.addEventListener('keydown', markInteraction, { passive: true });
    document.addEventListener('mousedown', markInteraction, { passive: true });
    document.addEventListener('touchstart', markInteraction, { passive: true });

    intervalRef.current = setInterval(tick, intervalMs);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('keydown', markInteraction);
      document.removeEventListener('mousedown', markInteraction);
      document.removeEventListener('touchstart', markInteraction);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [intervalMs, tick]);
}
