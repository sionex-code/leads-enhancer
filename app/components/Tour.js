"use client";

import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { X, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { Button } from "./ui/button";

// Lightweight, dependency-free guided tour. Each step targets an element by its
// `data-tour="<key>"` attribute; if the element isn't on the current page the
// step just renders centered (no spotlight) so the copy still shows. Spotlight is
// a single huge box-shadow around the highlighted element's rect.
//
// Props: steps = [{ key, title, body }], open, onClose(completed: boolean).
export default function Tour({ steps = [], open, onClose }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);

  const step = steps[idx];

  const measure = useCallback(() => {
    if (!step) return;
    const el = typeof document !== "undefined" ? document.querySelector(`[data-tour="${step.key}"]`) : null;
    // Treat a missing OR hidden target (e.g. desktop-only sidebar items that are
    // display:none on mobile) as "no target" → center the card instead of
    // spotlighting an off-screen/zero-size rect.
    const hidden = el && el.offsetParent === null && getComputedStyle(el).position !== "fixed";
    if (!el || hidden) { setRect(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) { setRect(null); return; }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    const t = setTimeout(measure, 250); // re-measure after scrollIntoView settles
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      clearTimeout(t);
    };
  }, [open, idx, measure]);

  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.(false);
      if (e.key === "ArrowRight") setIdx((i) => Math.min(steps.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, steps.length, onClose]);

  if (!open || !step) return null;

  const pad = 6;
  const isLast = idx === steps.length - 1;

  // Position the tooltip below the highlight if there's room, else above; when no
  // target, center it. Width is clamped to the viewport so it never spills off a
  // narrow phone screen.
  const vw = typeof window !== "undefined" ? window.innerWidth : 360;
  const vh = typeof window !== "undefined" ? window.innerHeight : 640;
  const tipWidth = Math.min(320, vw - 24);
  let tipStyle;
  if (rect) {
    const placeBelow = rect.top + rect.height + 12 + 180 < vh;
    tipStyle = {
      position: "fixed",
      top: placeBelow ? rect.top + rect.height + 12 : Math.max(12, rect.top - 12 - 180),
      left: Math.min(Math.max(12, rect.left), vw - tipWidth - 12),
      width: tipWidth,
    };
  } else {
    tipStyle = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: tipWidth };
  }

  return (
    <div className="fixed inset-0 z-[80]" aria-modal="true" role="dialog">
      {/* Spotlight (or full dim when no target) */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/55" />
      )}

      {/* Click-catcher to dismiss on backdrop tap */}
      <button aria-label="Close tour" className="absolute inset-0 h-full w-full cursor-default" onClick={() => onClose?.(false)} />

      {/* Tooltip card */}
      <div style={tipStyle} className="rounded-xl border border-border bg-card p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">{step.title}</h3>
          <button onClick={() => onClose?.(false)} aria-label="Skip tour" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{idx + 1} / {steps.length}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onClose?.(false)}>Skip</Button>
            {idx > 0 && (
              <Button variant="outline" size="sm" onClick={() => setIdx((i) => Math.max(0, i - 1))}><ArrowLeft className="h-4 w-4" /> Back</Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={() => onClose?.(true)}><Check className="h-4 w-4" /> Done</Button>
            ) : (
              <Button size="sm" onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}>Next <ArrowRight className="h-4 w-4" /></Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
