import { ImageResponse } from "next/og";

// Generated rather than shipped as a file: there is no designed OG asset in the
// repo, and without any image every shared link previews as a bare text card.
// This renders at build/request time and is cached by Next.
export const runtime = "nodejs";
export const alt = "LeadsFunda - Google Maps lead generation with email enrichment";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Kept to system fonts on purpose: loading a webfont here means a network fetch
// on every cold render, and a failed fetch means no preview image at all.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0b0f1d 0%, #16203a 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#f59e0b", fontWeight: 700 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#f59e0b" }} />
          LeadsFunda
        </div>

        <div style={{ display: "flex", fontSize: 68, fontWeight: 800, lineHeight: 1.1, marginTop: 36, letterSpacing: "-0.02em" }}>
          Local business leads, enriched and ready to send.
        </div>

        <div style={{ display: "flex", fontSize: 30, color: "#94a3b8", marginTop: 28, lineHeight: 1.35 }}>
          Scrape the map · Find emails, WhatsApp and socials · Audit their sites
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 44 }}>
          {["Smartlead", "Instantly", "HubSpot", "Pipedrive", "n8n"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                fontSize: 24,
                fontWeight: 600,
                padding: "10px 22px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.18)",
                color: "#e2e8f0",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
