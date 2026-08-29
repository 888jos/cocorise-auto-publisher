import { Readable } from "stream";
import { google } from "googleapis";

function oauthClient(accessToken: string, refreshToken: string | null) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured.");
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken || undefined });
  return auth;
}

export async function publishYouTubeShort(input: {
  accessToken: string;
  refreshToken: string | null;
  buffer: Buffer;
  mimeType: string;
  filename: string;
  caption: string;
}) {
  const youtube = google.youtube({ version: "v3", auth: oauthClient(input.accessToken, input.refreshToken) });
  const firstLine = input.caption.split("\n").map((line) => line.trim()).find(Boolean);
  const title = (firstLine || input.filename.replace(/\.mp4$/i, "")).slice(0, 100);
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description: input.caption.slice(0, 5000),
        categoryId: "22"
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      mimeType: input.mimeType.startsWith("video/") ? input.mimeType : "video/mp4",
      body: Readable.from(input.buffer)
    }
  });
  if (!response.data.id) throw new Error("YouTube did not return a video ID after upload.");

  return {
    status: "processing" as const,
    uploadSessionId: null,
    externalPostId: response.data.id,
    postUrl: `https://www.youtube.com/shorts/${response.data.id}`,
    rawStatus: response.data as Record<string, unknown>
  };
}

export async function checkYouTubeShort(accessToken: string, refreshToken: string | null, videoId: string) {
  const youtube = google.youtube({ version: "v3", auth: oauthClient(accessToken, refreshToken) });
  const response = await youtube.videos.list({ part: ["status", "processingDetails"], id: [videoId] });
  const video = response.data.items?.[0];
  if (!video) {
    return { status: "failed" as const, externalPostId: videoId, postUrl: null, errorMessage: "YouTube no longer returns the uploaded video.", rawStatus: {} };
  }

  const uploadStatus = video.status?.uploadStatus || "unknown";
  const processingStatus = video.processingDetails?.processingStatus || "unknown";
  const rawStatus = JSON.parse(JSON.stringify(video)) as Record<string, unknown>;
  if (["failed", "rejected", "deleted"].includes(uploadStatus) || processingStatus === "failed" || processingStatus === "terminated") {
    return {
      status: "failed" as const,
      externalPostId: videoId,
      postUrl: `https://www.youtube.com/shorts/${videoId}`,
      errorMessage: video.status?.rejectionReason || video.processingDetails?.processingFailureReason || `YouTube returned ${uploadStatus}/${processingStatus}.`,
      rawStatus
    };
  }

  if (uploadStatus === "processed" || processingStatus === "succeeded") {
    if (video.status?.privacyStatus !== "public") {
      return {
        status: "failed" as const,
        externalPostId: videoId,
        postUrl: `https://studio.youtube.com/video/${videoId}/edit`,
        errorMessage: "YouTube processed the video but kept it private. The Google API project likely still requires a YouTube upload audit.",
        rawStatus
      };
    }
    return {
      status: "published" as const,
      externalPostId: videoId,
      postUrl: `https://www.youtube.com/shorts/${videoId}`,
      errorMessage: null,
      rawStatus
    };
  }

  return {
    status: "processing" as const,
    externalPostId: videoId,
    postUrl: `https://studio.youtube.com/video/${videoId}/edit`,
    errorMessage: null,
    rawStatus
  };
}
