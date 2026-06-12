import AgentClient from "./AgentClient";

export const metadata = { title: "AI Agent — Lead Ops" };

// Without this the page is statically prerendered and served with
// s-maxage=31536000, which the VPS nginx caches — deploys never show up.
export const dynamic = "force-dynamic";

export default function AgentPage() {
  return <AgentClient />;
}
