"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "leadops-leads-hidden-columns";

export default function useColumnVisibility() {
  const [hidden, setHidden] = useState([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setHidden(parsed);
      }
    } catch {}
  }, []);

  const toggle = useCallback((colId) => {
    setHidden((prev) => {
      const next = prev.includes(colId)
        ? prev.filter((c) => c !== colId)
        : [...prev, colId];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const isVisible = useCallback(
    (colId) => !hidden.includes(colId),
    [hidden]
  );

  const reset = useCallback(() => {
    setHidden([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  return { hidden, toggle, isVisible, reset };
}
