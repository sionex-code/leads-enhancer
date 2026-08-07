"use client";

import { useEffect, useState } from "react";

function format(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs} second${secs === 1 ? "" : "s"} ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// "12 seconds ago", ticking.
//
// Computed after mount, never during render: the server and the browser would
// otherwise produce different strings for the same timestamp and React would
// report a hydration mismatch. Renders nothing until it has a real value.
export default function RelativeTime({ iso, className = "" }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!iso) return;
    const tick = () => setLabel(format(iso));
    tick();
    // Seconds matter for a fresh entry; past a minute they don't.
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [iso]);

  if (!label) return null;
  return (
    <time dateTime={iso} className={className}>
      {label}
    </time>
  );
}
