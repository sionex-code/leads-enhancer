// A sketch of the top of the browser's extensions page, used twice: once to
// point at the Developer mode toggle, once at the Load unpacked button.
//
// Worth the pixels because both controls are described by position ("top-right",
// "top-left") and someone who has never opened this page has no idea what they
// are looking at. Everything not being pointed at is dimmed, so the eye lands on
// one thing.
//
// Colours come from the shadcn tokens directly rather than Tailwind fill-*
// utilities, which aren't generated for these custom colours.

const CARD = "hsl(var(--card))";
const LINE = "hsl(var(--border))";
const TEXT = "hsl(var(--foreground))";
const MUTED = "hsl(var(--muted-foreground))";
const FILL = "hsl(var(--muted))";
const BRAND = "hsl(var(--primary))";

const LABELS = {
  developer: "The Developer mode switch sits at the top right of the extensions page.",
  load: "The Load unpacked button sits at the top left, under the page title.",
};

export default function ExtensionsPageDiagram({ highlight }) {
  const dev = highlight === "developer";
  const load = highlight === "load";

  // Dim whatever isn't the subject of this step.
  const devOpacity = load ? 0.35 : 1;
  const loadOpacity = dev ? 0.35 : 1;

  return (
    <svg
      viewBox="0 0 480 116"
      role="img"
      aria-label={LABELS[highlight] || "The browser extensions page"}
      className="mt-3 w-full max-w-md"
    >
      {/* page chrome */}
      <rect x="1" y="1" width="478" height="114" rx="10" fill={CARD} stroke={LINE} />

      <text x="20" y="30" fontSize="13" fontWeight="600" fill={TEXT}>
        Extensions
      </text>

      {/* Developer mode toggle, top right */}
      <g opacity={devOpacity}>
        <text x="416" y="29" fontSize="11" textAnchor="end" fill={dev ? TEXT : MUTED}>
          Developer mode
        </text>
        <rect
          x="426"
          y="16"
          width="34"
          height="18"
          rx="9"
          fill={dev ? BRAND : FILL}
          stroke={dev ? BRAND : LINE}
        />
        <circle cx={dev ? 451 : 435} cy="25" r="6.5" fill={dev ? CARD : MUTED} />
        {dev && (
          <rect
            x="318"
            y="8"
            width="150"
            height="34"
            rx="10"
            fill="none"
            stroke={BRAND}
            strokeWidth="2"
          />
        )}
      </g>

      <line x1="1" y1="48" x2="479" y2="48" stroke={LINE} />

      {/* Action buttons, top left - these only appear once Developer mode is on */}
      <g opacity={loadOpacity}>
        <rect
          x="20"
          y="64"
          width="104"
          height="30"
          rx="8"
          fill={load ? BRAND : FILL}
          stroke={load ? BRAND : LINE}
        />
        <text
          x="72"
          y="83"
          fontSize="11"
          fontWeight="600"
          textAnchor="middle"
          fill={load ? "hsl(var(--primary-foreground))" : MUTED}
        >
          Load unpacked
        </text>

        <rect x="134" y="64" width="104" height="30" rx="8" fill={FILL} stroke={LINE} />
        <text x="186" y="83" fontSize="11" textAnchor="middle" fill={MUTED}>
          Pack extension
        </text>

        <rect x="248" y="64" width="68" height="30" rx="8" fill={FILL} stroke={LINE} />
        <text x="282" y="83" fontSize="11" textAnchor="middle" fill={MUTED}>
          Update
        </text>
      </g>
    </svg>
  );
}
