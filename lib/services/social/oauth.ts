import { google } from "googleapis";
import { fetchJson, expiresAt } from "@/lib/services/social/http";
import type { SocialConnection, SocialPlatform } from "@/lib/types/domain";

export type OAuthCredentials = {
  externalAccountId: string;
  externalUsername: string | null;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION || "v26.0";
}

function googleOAuth(redirectUri?: string) {
  return new google.auth.OAuth2(required("GOOGLE_CLIENT_ID"), required("GOOGLE_CLIENT_SECRET"), redirectUri);
}

export function buildOAuthAuthorizationUrl(platform: SocialPlatform, redirectUri: string, state: string) {
  if (platform === "tiktok") {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({
      client_key: required("TIKTOK_CLIENT_KEY"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "user.info.basic,video.publish",
      state
    }).toString();
    return url.toString();
  }

  if (platform === "instagram") {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      enable_fb_login: "0",
      force_authentication: "1",
      client_id: required("INSTAGRAM_APP_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_content_publish",
      state
    }).toString();
    return url.toString();
  }

  return googleOAuth(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]
  });
}

async function exchangeTikTokCode(code: string, redirectUri: string): Promise<OAuthCredentials> {
  const token = await fetchJson<{
    access_token: string;
    expires_in: number;
    open_id: string;
    refresh_expires_in: number;
    refresh_token: string;
    scope: string;
  }>(
    "https://open.tiktokapis.com/v2/oauth/token/",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: required("TIKTOK_CLIENT_KEY"),
        client_secret: required("TIKTOK_CLIENT_SECRET"),
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    },
    "TikTok OAuth"
  );

  const profile = await fetchJson<{
    data?: { user?: { open_id?: string; display_name?: string; username?: string; avatar_url?: string } };
    error?: { code?: string; message?: string };
  }>(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,avatar_url",
    { headers: { Authorization: `Bearer ${token.access_token}` } },
    "TikTok"
  );

  if (profile.error?.code && profile.error.code !== "ok") throw new Error(`TikTok profile error: ${profile.error.message || profile.error.code}`);
  const user = profile.data?.user;
  return {
    externalAccountId: user?.open_id || token.open_id,
    externalUsername: user?.username || user?.display_name || null,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt: expiresAt(token.expires_in),
    refreshTokenExpiresAt: expiresAt(token.refresh_expires_in),
    scopes: token.scope.split(",").filter(Boolean),
    metadata: { display_name: user?.display_name, avatar_url: user?.avatar_url }
  };
}

async function exchangeInstagramCode(code: string, redirectUri: string): Promise<OAuthCredentials> {
  const shortToken = await fetchJson<{ access_token: string; user_id: string; permissions?: string[] }>(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: required("INSTAGRAM_APP_ID"),
        client_secret: required("INSTAGRAM_APP_SECRET"),
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: code.replace(/#_$/, "")
      })
    },
    "Instagram OAuth"
  );

  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: required("INSTAGRAM_APP_SECRET"),
    access_token: shortToken.access_token
  }).toString();
  const longToken = await fetchJson<{ access_token: string; token_type?: string; expires_in: number }>(longUrl.toString(), {}, "Instagram OAuth");

  const profileUrl = new URL(`https://graph.instagram.com/${graphVersion()}/me`);
  profileUrl.search = new URLSearchParams({ fields: "id,user_id,username,name,account_type", access_token: longToken.access_token }).toString();
  const profile = await fetchJson<{ id?: string; user_id?: string; username?: string; name?: string; account_type?: string }>(profileUrl.toString(), {}, "Instagram");

  return {
    externalAccountId: profile.user_id || profile.id || shortToken.user_id,
    externalUsername: profile.username || profile.name || null,
    accessToken: longToken.access_token,
    refreshToken: null,
    accessTokenExpiresAt: expiresAt(longToken.expires_in),
    refreshTokenExpiresAt: null,
    scopes: shortToken.permissions || ["instagram_business_basic", "instagram_business_content_publish"],
    metadata: { account_type: profile.account_type, graph_id: profile.id }
  };
}

async function exchangeYouTubeCode(code: string, redirectUri: string): Promise<OAuthCredentials> {
  const auth = googleOAuth(redirectUri);
  const { tokens } = await auth.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Reconnect and approve consent again.");
  }
  auth.setCredentials(tokens);
  const youtube = google.youtube({ version: "v3", auth });
  const channels = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channel = channels.data.items?.[0];
  if (!channel?.id) throw new Error("No YouTube channel is available for this Google account.");

  return {
    externalAccountId: channel.id,
    externalUsername: channel.snippet?.title || null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    refreshTokenExpiresAt: null,
    scopes: (tokens.scope || "").split(" ").filter(Boolean),
    metadata: { channel_title: channel.snippet?.title }
  };
}

export function exchangeOAuthCode(platform: SocialPlatform, code: string, redirectUri: string) {
  if (platform === "tiktok") return exchangeTikTokCode(code, redirectUri);
  if (platform === "instagram") return exchangeInstagramCode(code, redirectUri);
  return exchangeYouTubeCode(code, redirectUri);
}

export async function refreshOAuthCredentials(platform: SocialPlatform, connection: SocialConnection, accessToken: string, refreshToken: string | null) {
  if (platform === "tiktok") {
    if (!refreshToken) throw new Error("TikTok refresh token is missing.");
    const token = await fetchJson<{
      access_token: string;
      expires_in: number;
      refresh_expires_in: number;
      refresh_token: string;
      scope: string;
    }>(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: required("TIKTOK_CLIENT_KEY"),
          client_secret: required("TIKTOK_CLIENT_SECRET"),
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      },
      "TikTok OAuth"
    );
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpiresAt: expiresAt(token.expires_in),
      refreshTokenExpiresAt: expiresAt(token.refresh_expires_in),
      scopes: token.scope.split(",").filter(Boolean)
    };
  }

  if (platform === "instagram") {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken }).toString();
    const token = await fetchJson<{ access_token: string; expires_in: number }>(url.toString(), {}, "Instagram OAuth");
    return {
      accessToken: token.access_token,
      refreshToken: null,
      accessTokenExpiresAt: expiresAt(token.expires_in),
      refreshTokenExpiresAt: null,
      scopes: connection.scopes
    };
  }

  if (!refreshToken) throw new Error("YouTube refresh token is missing.");
  const auth = googleOAuth();
  auth.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await auth.refreshAccessToken();
  if (!credentials.access_token) throw new Error("Google did not return a refreshed access token.");
  return {
    accessToken: credentials.access_token,
    refreshToken: credentials.refresh_token || refreshToken,
    accessTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
    refreshTokenExpiresAt: null,
    scopes: (credentials.scope || connection.scopes.join(" ")).split(" ").filter(Boolean)
  };
}
