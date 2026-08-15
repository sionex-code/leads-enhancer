"use client";

import { useEffect, useState } from "react";
import { detectExtension, getLatestExtensionVersion, versionAtLeast } from "./extension-client";

/**
 * Is the LeadsFunda browser extension installed and talking to us - and if so,
 * is it running the build we currently publish?
 *
 * Shared by the sidebar badge, the update banner and the /extension install
 * page so they can't disagree about the answer.
 *
 * @param {object}  opts
 * @param {boolean} opts.poll  Keep re-checking until it's found. On for the
 *   install page (the user is installing it *right now* and shouldn't have to
 *   reload to see it work); off elsewhere, where one check is plenty.
 * @returns {{checking: boolean, installed: boolean, version: string|null,
 *   latestVersion: string|null, outdated: boolean}}
 */
export default function useExtension({ poll = false, timeoutMs = 2500 } = {}) {
  const [state, setState] = useState({ checking: true, version: null, latestVersion: null });

  useEffect(() => {
    let alive = true;
    let timer;

    async function check() {
      const [version, latestVersion] = await Promise.all([
        detectExtension({ timeoutMs }),
        getLatestExtensionVersion(),
      ]);
      if (!alive) return;
      setState({ checking: false, version, latestVersion });
      if (!version && poll) timer = setTimeout(check, 2500);
    }

    check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [poll, timeoutMs]);

  const installed = !!state.version;
  // "unknown" is what detectExtension reports when a bridge answers without a
  // version. Treating that as outdated would nag people we can't actually
  // place, so it's left alone.
  const outdated =
    installed &&
    state.version !== "unknown" &&
    !!state.latestVersion &&
    !versionAtLeast(state.version, state.latestVersion);

  return { ...state, installed, outdated };
}
