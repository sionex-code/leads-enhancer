"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "leadops-sidebar-collapsed";

export default function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return [collapsed, toggleCollapsed];
}
