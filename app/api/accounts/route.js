import db from "../../../web/lib/db.cjs";

export async function GET() {
  return Response.json({ accounts: db.listAccounts() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const result = db.addAccount(body.name, body.cookies);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
