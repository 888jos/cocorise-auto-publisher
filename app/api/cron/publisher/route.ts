import { NextResponse } from "next/server";
import { assertCron, jsonError } from "@/lib/api";
import { runPublisher } from "@/lib/jobs/publisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = assertCron(request);
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json(await runPublisher());
  } catch (error) {
    return jsonError(error);
  }
}
