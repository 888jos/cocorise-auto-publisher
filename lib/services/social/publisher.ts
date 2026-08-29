import { checkInstagramReel, publishInstagramReel } from "@/lib/services/social/instagram";
import { checkTikTokVideo, publishTikTokVideo } from "@/lib/services/social/tiktok";
import { checkYouTubeShort, publishYouTubeShort } from "@/lib/services/social/youtube";
import type { AccountGroup, Publication, PublicationPlatform, SocialPlatform, Video } from "@/lib/types/domain";

export type VideoBinary = {
  filename: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

export function enabledPlatforms(account: AccountGroup): SocialPlatform[] {
  return [
    ...(account.tiktok_enabled ? (["tiktok"] as const) : []),
    ...(account.instagram_enabled ? (["instagram"] as const) : []),
    ...(account.youtube_enabled ? (["youtube"] as const) : [])
  ];
}

export async function startPlatformPublication(input: {
  platform: SocialPlatform;
  accessToken: string;
  refreshToken: string | null;
  externalAccountId: string;
  video: Video;
  binary: VideoBinary;
  publication: Publication;
}) {
  if (input.platform === "tiktok") {
    return publishTikTokVideo({ accessToken: input.accessToken, buffer: input.binary.buffer, mimeType: input.binary.mimeType, caption: input.publication.caption });
  }
  if (input.platform === "instagram") {
    return publishInstagramReel({
      accessToken: input.accessToken,
      instagramUserId: input.externalAccountId,
      buffer: input.binary.buffer,
      mimeType: input.binary.mimeType,
      caption: input.publication.caption
    });
  }
  return publishYouTubeShort({
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    buffer: input.binary.buffer,
    mimeType: input.binary.mimeType,
    filename: input.video.filename,
    caption: input.publication.caption
  });
}

export async function checkPlatformPublication(input: {
  row: PublicationPlatform;
  accessToken: string;
  refreshToken: string | null;
  externalAccountId: string;
}) {
  if (input.row.platform === "tiktok") {
    if (!input.row.upload_session_id) throw new Error("TikTok publish ID is missing.");
    return checkTikTokVideo(input.accessToken, input.row.upload_session_id);
  }
  if (input.row.platform === "instagram") {
    if (!input.row.upload_session_id) throw new Error("Instagram container ID is missing.");
    return checkInstagramReel(input.accessToken, input.externalAccountId, input.row.upload_session_id);
  }
  if (!input.row.external_post_id) throw new Error("YouTube video ID is missing.");
  return checkYouTubeShort(input.accessToken, input.refreshToken, input.row.external_post_id);
}

export function aggregatePlatformRows(rows: PublicationPlatform[]) {
  if (!rows.length) return { status: "failed" as const, error: "No enabled social platform was prepared." };
  if (rows.every((row) => row.status === "published" || row.status === "skipped")) return { status: "published" as const, error: null };
  if (rows.some((row) => ["pending", "uploading", "processing"].includes(row.status))) return { status: "processing" as const, error: null };
  const failed = rows.filter((row) => row.status === "failed");
  if (failed.length) {
    return {
      status: "failed" as const,
      error: failed.map((row) => `${row.platform}: ${row.error_message || "publication failed"}`).join(" | ")
    };
  }
  return { status: "processing" as const, error: null };
}
