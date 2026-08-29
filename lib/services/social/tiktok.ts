import { fetchJson } from "@/lib/services/social/http";

const maxVideoSize = 4_000_000_000;
const maxSingleChunk = 64_000_000;
const regularChunkSize = 32_000_000;

type TikTokEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
};

function assertTikTok<T>(response: TikTokEnvelope<T>) {
  if (response.error?.code && response.error.code !== "ok") {
    throw new Error(`TikTok API error ${response.error.code}: ${response.error.message || "Unknown error"}`);
  }
  if (!response.data) throw new Error("TikTok returned no response data.");
  return response.data;
}

export function planTikTokChunks(videoSize: number) {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) throw new Error("TikTok video size must be a positive integer.");
  if (videoSize > maxVideoSize) throw new Error("TikTok videos cannot exceed 4 GB.");
  if (videoSize <= maxSingleChunk) return { chunkSize: videoSize, totalChunkCount: 1 };
  return { chunkSize: regularChunkSize, totalChunkCount: Math.floor(videoSize / regularChunkSize) };
}

export async function publishTikTokVideo(input: { accessToken: string; buffer: Buffer; mimeType: string; caption: string }) {
  const creator = assertTikTok(
    await fetchJson<TikTokEnvelope<{
      creator_username?: string;
      privacy_level_options?: string[];
      comment_disabled?: boolean;
      duet_disabled?: boolean;
      stitch_disabled?: boolean;
      max_video_post_duration_sec?: number;
    }>>(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8" }
      },
      "TikTok"
    )
  );

  if (!creator.privacy_level_options?.includes("PUBLIC_TO_EVERYONE")) {
    throw new Error("TikTok does not currently allow PUBLIC_TO_EVERYONE for this creator. Check account privacy and app audit status.");
  }

  const chunks = planTikTokChunks(input.buffer.byteLength);
  const initialized = assertTikTok(
    await fetchJson<TikTokEnvelope<{ publish_id: string; upload_url: string }>>(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          post_info: {
            title: input.caption.slice(0, 2200),
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_duet: Boolean(creator.duet_disabled),
            disable_comment: Boolean(creator.comment_disabled),
            disable_stitch: Boolean(creator.stitch_disabled),
            brand_content_toggle: false,
            brand_organic_toggle: true,
            is_aigc: process.env.TIKTOK_CONTENT_IS_AIGC === "true"
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: input.buffer.byteLength,
            chunk_size: chunks.chunkSize,
            total_chunk_count: chunks.totalChunkCount
          }
        })
      },
      "TikTok"
    )
  );

  let offset = 0;
  for (let index = 0; index < chunks.totalChunkCount; index += 1) {
    const isLast = index === chunks.totalChunkCount - 1;
    const endExclusive = isLast ? input.buffer.byteLength : offset + chunks.chunkSize;
    const chunk = input.buffer.subarray(offset, endExclusive);
    const response = await fetch(initialized.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": ["video/mp4", "video/quicktime", "video/webm"].includes(input.mimeType) ? input.mimeType : "video/mp4",
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${offset}-${endExclusive - 1}/${input.buffer.byteLength}`
      },
      body: chunk as unknown as BodyInit
    });
    const expectedStatus = isLast ? 201 : 206;
    if (response.status !== expectedStatus) {
      const body = await response.text();
      throw new Error(`TikTok chunk ${index + 1}/${chunks.totalChunkCount} failed (${response.status}): ${body.slice(0, 600)}`);
    }
    offset = endExclusive;
  }

  return {
    status: "processing" as const,
    uploadSessionId: initialized.publish_id,
    externalPostId: null,
    postUrl: null,
    rawStatus: { publish_id: initialized.publish_id, creator_username: creator.creator_username }
  };
}

export async function checkTikTokVideo(accessToken: string, publishId: string) {
  const data = assertTikTok(
    await fetchJson<TikTokEnvelope<{
      status: string;
      fail_reason?: string;
      publicaly_available_post_id?: Array<string | number>;
      uploaded_bytes?: number;
    }>>(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId })
      },
      "TikTok"
    )
  );

  if (data.status === "FAILED" || data.status === "SEND_TO_USER_INBOX") {
    return {
      status: "failed" as const,
      externalPostId: null,
      postUrl: null,
      errorMessage: data.fail_reason || `TikTok returned ${data.status}.`,
      rawStatus: data
    };
  }
  if (data.status === "PUBLISH_COMPLETE") {
    const postId = data.publicaly_available_post_id?.[0]?.toString() || null;
    if (!postId) {
      return {
        status: "failed" as const,
        externalPostId: null,
        postUrl: null,
        errorMessage: "TikTok completed the upload but returned no publicly available post ID. The app audit may still be pending.",
        rawStatus: data
      };
    }
    return { status: "published" as const, externalPostId: postId, postUrl: `https://www.tiktok.com/video/${postId}`, errorMessage: null, rawStatus: data };
  }
  return { status: "processing" as const, externalPostId: null, postUrl: null, errorMessage: null, rawStatus: data };
}
