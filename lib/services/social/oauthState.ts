import { createHmac, timingSafeEqual } from "crypto";
import type { SocialPlatform } from "@/lib/types/domain";

type OAuthState = {
  accountGroupId: string;
  platform: SocialPlatform;
  redirectUri: string;
  expiresAt: number;
};

function stateSecret() {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error("OAUTH_STATE_SECRET is not configured.");
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}

export function createOAuthState(input: Omit<OAuthState, "expiresAt">) {
  const payload = Buffer.from(JSON.stringify({ ...input, expiresAt: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyOAuthState(value: string): OAuthState {
  const [payload, providedSignature] = value.split(".");
  if (!payload || !providedSignature) throw new Error("OAuth state is malformed.");

  const expected = Buffer.from(signature(payload));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new Error("OAuth state signature is invalid.");
  }

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  if (parsed.expiresAt < Date.now()) throw new Error("OAuth state has expired.");
  if (!parsed.accountGroupId || !parsed.redirectUri || !["tiktok", "instagram", "youtube"].includes(parsed.platform)) {
    throw new Error("OAuth state is incomplete.");
  }
  return parsed;
}

export function appBaseUrl(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}
