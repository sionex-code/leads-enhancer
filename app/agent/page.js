import { notFound } from "next/navigation";
import AgentClient from "./AgentClient";

export const metadata = { title: "AI Agent — LeadsFunda" };

// Without this the page is statically prerendered and served with
// s-maxage=31536000, which the VPS nginx caches — deploys never show up.
export const dynamic = "force-dynamic";

export default function AgentPage() {
  // AI agent mode is temporarily hidden for the SaaS launch. Enable with FEATURE_AGENT=1.
  if (process.env.FEATURE_AGENT !== "1") notFound();
  return <AgentClient />;
}
