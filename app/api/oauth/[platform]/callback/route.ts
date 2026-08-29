import { NextRequest, NextResponse } from "next/server";
import { logAction } from "@/lib/logger";
import { exchangeOAuthCode } from "@/lib/services/social/oauth";
import { verifyOAuthState } from "@/lib/services/social/oauthState";
import { saveSocialConnection } from "@/lib/services/social/connections";
import { createServiceClient } from "@/lib/supabase/server";
import type { SocialPlatform } from "@/lib/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPlatform(value: string): value is SocialPlatform {
  return ["tiktok", "instagram", "youtube"].includes(value);
}

function accountsRedirect(request: Request, key: "oauth_success" | "oauth_error", value: string) {
  const url = new URL("/accounts", request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const { platform: rawPlatform } = await context.params;
  if (!isPlatform(rawPlatform)) return NextResponse.json({ error: "Unsupported social platform." }, { status: 404 });

  try {
    const providerError = request.nextUrl.searchParams.get("error_description") || request.nextUrl.searchParams.get("error");
    if (providerError) throw new Error(providerError);

    const code = request.nextUrl.searchParams.get("code");
    const stateValue = request.nextUrl.searchParams.get("state");
    if (!code || !stateValue) throw new Error("OAuth callback is missing code or state.");

    const state = verifyOAuthState(stateValue);
    if (state.platform !== rawPlatform) throw new Error("OAuth platform does not match the signed state.");

    const credentials = await exchangeOAuthCode(rawPlatform, code, state.redirectUri);
    await saveSocialConnection(state.accountGroupId, rawPlatform, credentials);
    await logAction(createServiceClient(), {
      action: `oauth_connect_${rawPlatform}`,
      status: "connected",
      accountGroupId: state.accountGroupId
    });
    return accountsRedirect(request, "oauth_success", `${rawPlatform} connected`);
  } catch (error) {
    return accountsRedirect(request, "oauth_error", error instanceof Error ? error.message : "OAuth connection failed.");
  }
}
