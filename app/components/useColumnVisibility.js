"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "leadops-leads-hidden-columns";

export default function useColumnVisibility() {
  const [hidden, setHidden] = useState([]);
  // Track whether we've hydrated from localStorage yet so we don't overwrite
  // stored prefs with the default [] during the first render.
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount (post-mount to stay SSR-safe).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setHidden(parsed);
      }
    } catch {}
    setHydrated(true);
  }, []);

  // Persist whenever hidden changes — but only after hydration so we don't
  // clobber saved prefs with the default empty array on first paint.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
    } catch {}
  }, [hidden, hydrated]);

  const toggle = useCallback((colId) => {
    setHidden((prev) =>
      prev.includes(colId)
        ? prev.filter((c) => c !== colId)
        : [...prev, colId]
    );
  }, []);

  const isVisible = useCallback((colId) => !hidden.includes(colId), [hidden]);

  const reset = useCallback(() => setHidden([]), []);

  return { hidden, toggle, isVisible, reset };
}
