"use client";

// A strip pinned to the bottom-centre of the viewport - the selection toolbar
// both lead tables use, so a selection is actionable from wherever you are in a
// long table instead of only near the top of it.
//
// It has to portal out to <body>: pages render inside an `animate-page-in`
// wrapper whose animation uses `both` fill mode, so its transform sticks around
// after it finishes. A transformed ancestor becomes the containing block for any
// `position: fixed` descendant, which would anchor the dock to the (very tall)
// page instead of the screen - thousands of pixels down the document. Rendering
// into <body> steps outside that subtree. (ui/sheet.js and ui/dialog.js portal
// for the same reason.)

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function BottomDock({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="lf pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      {children}
    </div>,
    document.body
  );
}
