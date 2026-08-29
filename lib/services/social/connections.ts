import { decryptToken, encryptToken } from "@/lib/security/tokens";
import { refreshOAuthCredentials, type OAuthCredentials } from "@/lib/services/social/oauth";
import { createServiceClient } from "@/lib/supabase/server";
import type { SocialConnection, SocialPlatform } from "@/lib/types/domain";

function shouldRefresh(expiresAt: string | null) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now() + 10 * 60_000;
}

export async function saveSocialConnection(accountGroupId: string, platform: SocialPlatform, credentials: OAuthCredentials) {
  const db = createServiceClient();
  const { error } = await db.from("social_connections").upsert(
    {
      account_group_id: accountGroupId,
      platform,
      status: "connected",
      external_account_id: credentials.externalAccountId,
      external_username: credentials.externalUsername,
      access_token_encrypted: encryptToken(credentials.accessToken),
      refresh_token_encrypted: credentials.refreshToken ? encryptToken(credentials.refreshToken) : null,
      access_token_expires_at: credentials.accessTokenExpiresAt,
      refresh_token_expires_at: credentials.refreshTokenExpiresAt,
      scopes: credentials.scopes,
      metadata: credentials.metadata,
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    { onConflict: "account_group_id,platform" }
  );
  if (error) throw error;
}

export async function getValidSocialConnection(accountGroupId: string, platform: SocialPlatform) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("social_connections")
    .select("*")
    .eq("account_group_id", accountGroupId)
    .eq("platform", platform)
    .maybeSingle<SocialConnection>();
  if (error) throw error;
  if (!data) throw new Error(`${platform} is not connected for this account group.`);
  if (data.status !== "connected") throw new Error(`${platform} connection is ${data.status}: ${data.last_error || "reconnect it"}.`);

  let accessToken = decryptToken(data.access_token_encrypted);
  let refreshToken = data.refresh_token_encrypted ? decryptToken(data.refresh_token_encrypted) : null;
  let connection = data;

  if (shouldRefresh(data.access_token_expires_at)) {
    try {
      const refreshed = await refreshOAuthCredentials(platform, data, accessToken, refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      const update = {
        access_token_encrypted: encryptToken(accessToken),
        refresh_token_encrypted: refreshToken ? encryptToken(refreshToken) : null,
        access_token_expires_at: refreshed.accessTokenExpiresAt,
        refresh_token_expires_at: refreshed.refreshTokenExpiresAt,
        scopes: refreshed.scopes,
        status: "connected",
        last_error: null,
        updated_at: new Date().toISOString()
      };
      const { data: updated, error: updateError } = await db.from("social_connections").update(update).eq("id", data.id).select("*").single<SocialConnection>();
      if (updateError) throw updateError;
      connection = updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth token refresh failed.";
      await db.from("social_connections").update({ status: "expired", last_error: message, updated_at: new Date().toISOString() }).eq("id", data.id);
      throw new Error(`${platform} token refresh failed: ${message}`);
    }
  }

  return { connection, accessToken, refreshToken };
}

export async function deleteSocialConnection(accountGroupId: string, platform: SocialPlatform) {
  const db = createServiceClient();
  const { error } = await db.from("social_connections").delete().eq("account_group_id", accountGroupId).eq("platform", platform);
  if (error) throw error;
}
