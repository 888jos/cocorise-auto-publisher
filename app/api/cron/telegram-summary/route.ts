import { NextResponse } from "next/server";
import { assertCron, jsonError } from "@/lib/api";
import { sendTelegramDailySummary } from "@/lib/services/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const unauthorized = assertCron(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await sendTelegramDailySummary());
  } catch (error) {
    return jsonError(error);
  }
}
