"use client";

import { useEffect, useRef, useState } from "react";

// Counts smoothly from the previously shown value to the new one (ease-out
// cubic), so polled counters tick up like a meter instead of jumping. Starts
// from 0 on first mount so a fresh page animates 0 -> current too.
export default function AnimatedNumber({ value, duration = 700 }) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(0);
  const shownRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      shownRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return <>{display}</>;
}
