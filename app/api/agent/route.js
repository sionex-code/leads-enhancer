import agent from "../../../web/lib/agent.cjs";

export const dynamic = "force-dynamic";

// GET ?sessionId=… → one session transcript; no params → session list
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (sessionId) {
    const session = agent.readSession(sessionId);
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
    return Response.json(session);
  }
  return Response.json({ sessions: agent.listSessions() });
}

// POST { sessionId?, message, project?, model? } → starts/continues a chat turn
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (!body.message || !String(body.message).trim()) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  try {
    const result = agent.sendMessage({
      sessionId: body.sessionId || "",
      message: String(body.message),
      project: body.project,
      model: body.model === "reasoning" ? "reasoning" : "fast",
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 409 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  agent.deleteSession(sessionId);
  return Response.json({ ok: true });
}
