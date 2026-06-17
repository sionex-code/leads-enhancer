// The legacy "Lead Ops" dark theme (globals.css) now lives only on the /agent
// route so it can't bleed into the new shadcn app shell. The agent feature is
// gated behind FEATURE_AGENT (see agent/page.js); when enabled it renders with
// its original styling.
import "../globals.css";

export default function AgentLayout({ children }) {
  return children;
}
