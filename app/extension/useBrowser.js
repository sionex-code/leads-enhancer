"use client";

import { useEffect, useState } from "react";

// Three facts decide whether the install steps below are accurate or actively
// misleading:
//
//   1. Which browser — the extensions page lives at a different internal URL in
//      each one, and showing all four at once made the reader pick.
//   2. Whether it's Chromium at all — Firefox and Safari use a different
//      extension format entirely, so the steps can't work there and saying so
//      up front beats letting someone follow five steps into a dead end.
//   3. Which OS — unzipping is the one step that genuinely differs.

const BROWSERS = {
  chrome: { name: "Chrome", url: "chrome://extensions" },
  edge: { name: "Edge", url: "edge://extensions" },
  brave: { name: "Brave", url: "brave://extensions" },
  opera: { name: "Opera", url: "opera://extensions" },
  vivaldi: { name: "Vivaldi", url: "vivaldi://extensions" },
  firefox: { name: "Firefox", url: null },
  safari: { name: "Safari", url: null },
  unknown: { name: "your browser", url: "chrome://extensions" },
};

// Only these two are known not to work. Anything we can't identify falls
// through to the Chrome instructions rather than being blocked — an unknown
// user-agent is far more often a Chromium fork than it is Safari.
const UNSUPPORTED = new Set(["firefox", "safari"]);

function detect() {
  const ua = navigator.userAgent || "";

  let id = "unknown";
  if (/Firefox\//.test(ua)) id = "firefox";
  else if (/OPR\//.test(ua)) id = "opera";
  else if (/Edg\//.test(ua)) id = "edge";
  else if (/Vivaldi/.test(ua)) id = "vivaldi";
  else if (/Chrome\//.test(ua)) id = "chrome";
  else if (/Safari\//.test(ua)) id = "safari";

  const mac = /Mac OS X|Macintosh/.test(ua);
  // iPadOS reports itself as a desktop Mac; the touch count is the giveaway.
  const ipad = mac && navigator.maxTouchPoints > 1;
  const os = /Windows|Win32|Win64/.test(ua)
    ? "windows"
    : mac && !ipad
      ? "mac"
      : /Linux|X11|Android|CrOS/.test(ua)
        ? "linux"
        : "other";

  const mobile =
    ipad ||
    navigator.userAgentData?.mobile ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

  return { id, os, mobile };
}

/**
 * @returns {{ready: boolean, id: string, name: string, url: string|null,
 *   os: string, mobile: boolean, supported: boolean}}
 *
 * `ready` is false until after mount. Server and first client render share the
 * same placeholder, so hydration matches; anything OS- or browser-specific
 * should stay hidden until `ready` rather than flash the wrong instructions.
 */
export default function useBrowser() {
  const [state, setState] = useState({
    ready: false,
    id: "unknown",
    os: "other",
    mobile: false,
  });

  useEffect(() => {
    let alive = true;
    const base = detect();

    // Brave ships a Chrome user-agent deliberately, so sniffing can't see it.
    // This API is the only reliable tell, and it's a promise.
    const maybeBrave =
      base.id === "chrome" ? navigator.brave?.isBrave?.() : false;

    Promise.resolve(maybeBrave)
      .catch(() => false)
      .then((isBrave) => {
        if (!alive) return;
        setState({ ready: true, ...base, id: isBrave ? "brave" : base.id });
      });

    return () => {
      alive = false;
    };
  }, []);

  const meta = BROWSERS[state.id] || BROWSERS.unknown;
  return { ...state, ...meta, supported: !UNSUPPORTED.has(state.id) };
}

export { BROWSERS };
