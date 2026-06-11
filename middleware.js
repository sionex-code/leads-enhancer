import { NextResponse } from "next/server";

export function middleware(request) {
  const password = process.env.LEADS_UI_PASSWORD || "fry69";
  const user = process.env.LEADS_UI_USER || "admin";
  const auth = request.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");
  let decoded = "";
  try {
    decoded = scheme === "Basic" && encoded ? atob(encoded) : "";
  } catch {
    decoded = "";
  }

  if (decoded === `${user}:${password}`) return NextResponse.next();

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Lead Generation UI"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
