import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { buildOAuthAuthorizationUrl } from "@/lib/services/social/oauth";
import { appBaseUrl, createOAuthState } from "@/lib/services/social/oauthState";
import type { SocialPlatform } from "@/lib/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPlatform(value: string): value is SocialPlatform {
  return ["tiktok", "instagram", "youtube"].includes(value);
}

export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { platform: rawPlatform } = await context.params;
  if (!isPlatform(rawPlatform)) return NextResponse.json({ error: "Unsupported social platform." }, { status: 404 });

  const accountGroupId = request.nextUrl.searchParams.get("account_group_id");
  if (!accountGroupId) return NextResponse.json({ error: "account_group_id is required." }, { status: 400 });

  const db = createServiceClient();
  const { data: account } = await db.from("account_groups").select("id").eq("id", accountGroupId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account group not found." }, { status: 404 });

  const redirectUri = `${appBaseUrl(request)}/api/oauth/${rawPlatform}/callback`;
  const state = createOAuthState({ accountGroupId, platform: rawPlatform, redirectUri });
  return NextResponse.redirect(buildOAuthAuthorizationUrl(rawPlatform, redirectUri, state));
}
