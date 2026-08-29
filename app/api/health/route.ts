import { NextResponse } from "next/server";
import { getIntegrationReadiness } from "@/lib/integrations/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = getIntegrationReadiness();
  const ready = readiness.supabase && readiness.googleDrive && readiness.cron &&
    (readiness.provider === "upload_post" ? readiness.uploadPost : readiness.tiktok && readiness.instagram && readiness.youtube);

  return NextResponse.json(
    {
      status: ready ? "ready" : "configuration_required",
      provider: readiness.provider,
      integrations: {
        supabase: readiness.supabase,
        googleDrive: readiness.googleDrive,
        publishing: readiness.provider === "upload_post" ? readiness.uploadPost : readiness.tiktok && readiness.instagram && readiness.youtube,
        cronSecret: readiness.cron
      },
      checkedAt: new Date().toISOString()
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
