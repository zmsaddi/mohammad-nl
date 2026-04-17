'use client';

import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_INTERVAL = 30000; // 30 seconds

export function useAutoRefresh(fetchFn, intervalMs = DEFAULT_INTERVAL) {
  const intervalRef = useRef(null);
  const fetchRef = useRef(fetchFn);
  const visibleRef = useRef(true);

  fetchRef.current = fetchFn;

  const tick = useCallback(() => {
    if (visibleRef.current) {
      fetchRef.current();
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
      if (visibleRef.current) tick();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    intervalRef.current = setInterval(tick, intervalMs);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [intervalMs, tick]);
}
