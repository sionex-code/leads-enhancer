"use client";

import { useEffect, useState } from "react";
import { detectExtension } from "./extension-client";

/**
 * Is the LeadsFunda browser extension installed and talking to us?
 *
 * Shared by the sidebar badge and the /extension install page so the two can't
 * disagree about the answer.
 *
 * @param {object}  opts
 * @param {boolean} opts.poll  Keep re-checking until it's found. On for the
 *   install page (the user is installing it *right now* and shouldn't have to
 *   reload to see it work); off elsewhere, where one check is plenty.
 * @returns {{checking: boolean, installed: boolean, version: string|null}}
 */
export default function useExtension({ poll = false, timeoutMs = 2500 } = {}) {
  const [state, setState] = useState({ checking: true, version: null });

  useEffect(() => {
    let alive = true;
    let timer;

    async function check() {
      const version = await detectExtension({ timeoutMs });
      if (!alive) return;
      setState({ checking: false, version });
      if (!version && poll) timer = setTimeout(check, 2500);
    }

    check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [poll, timeoutMs]);

  return { ...state, installed: !!state.version };
}
