// App Router replays template.js on every navigation, so this wrapper's
// `animate-page-in` (fade + slide-up, see tailwind.config.mjs) re-runs on each
// route change — giving every page a smooth transition when it appears.
// `motion-reduce:animate-none` honors the OS "reduce motion" preference.
export default function Template({ children }) {
  return <div className="animate-page-in motion-reduce:animate-none">{children}</div>;
}
