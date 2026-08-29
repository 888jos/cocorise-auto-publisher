import { NextResponse } from "next/server";

export function assertCron(request: Request) {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${configured}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export function jsonError(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status });
}
