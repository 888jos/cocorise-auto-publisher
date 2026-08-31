import { NextRequest, NextResponse } from "next/server";
import { tiktokConnectionReturnUrl, tiktokLogoutUrl } from "@/lib/tiktokSession";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const expectedToken = request.cookies.get("cocorise_tiktok_reset")?.value;
  const profile = request.nextUrl.searchParams.get("profile")?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

  if (!token || !expectedToken || token !== expectedToken || !profile) {
    return NextResponse.redirect(new URL("/accounts?oauth_error=TikTok+session+reset+link+expired", appUrl));
  }

  const returnUrl = tiktokConnectionReturnUrl(appUrl, profile);
  const response = NextResponse.redirect(tiktokLogoutUrl(returnUrl));
  response.cookies.set("cocorise_tiktok_reset", "", {
    httpOnly: true,
    secure: new URL(appUrl).protocol === "https:",
    sameSite: "lax",
    maxAge: 0,
    path: "/api/oauth/tiktok/session-reset"
  });
  return response;
}
