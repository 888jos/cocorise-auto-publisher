import { fetchJson } from "@/lib/services/social/http";

function graphVersion() {
  return process.env.META_GRAPH_VERSION || "v26.0";
}

function graphUrl(path: string) {
  return `https://graph.instagram.com/${graphVersion()}/${path.replace(/^\//, "")}`;
}

export async function publishInstagramReel(input: {
  accessToken: string;
  instagramUserId: string;
  buffer: Buffer;
  mimeType: string;
  caption: string;
}) {
  const container = await fetchJson<{ id?: string; uri?: string }>(
    graphUrl(`${input.instagramUserId}/media`),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "REELS",
        upload_type: "resumable",
        caption: input.caption.slice(0, 2200),
        share_to_feed: "true",
        access_token: input.accessToken
      })
    },
    "Instagram"
  );
  if (!container.id) throw new Error("Instagram did not return a media container ID.");

  const uploadUrl = container.uri || `https://rupload.facebook.com/ig-api-upload/${graphVersion()}/${container.id}`;
  const uploaded = await fetchJson<Record<string, unknown>>(
    uploadUrl,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${input.accessToken}`,
        offset: "0",
        file_size: String(input.buffer.byteLength),
        "Content-Type": input.mimeType.startsWith("video/") ? input.mimeType : "video/mp4"
      },
      body: input.buffer as unknown as BodyInit
    },
    "Instagram upload"
  );

  return {
    status: "processing" as const,
    uploadSessionId: container.id,
    externalPostId: null,
    postUrl: null,
    rawStatus: { container, uploaded }
  };
}

export async function checkInstagramReel(accessToken: string, instagramUserId: string, containerId: string) {
  const statusUrl = new URL(graphUrl(containerId));
  statusUrl.search = new URLSearchParams({ fields: "status_code,status", access_token: accessToken }).toString();
  const container = await fetchJson<{ id?: string; status_code?: string; status?: string }>(statusUrl.toString(), {}, "Instagram");

  if (["ERROR", "EXPIRED"].includes(container.status_code || "")) {
    return {
      status: "failed" as const,
      externalPostId: null,
      postUrl: null,
      errorMessage: container.status || `Instagram container is ${container.status_code}.`,
      rawStatus: container
    };
  }
  if (container.status_code !== "FINISHED") {
    return { status: "processing" as const, externalPostId: null, postUrl: null, errorMessage: null, rawStatus: container };
  }

  const published = await fetchJson<{ id?: string }>(
    graphUrl(`${instagramUserId}/media_publish`),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: containerId, access_token: accessToken })
    },
    "Instagram"
  );
  if (!published.id) throw new Error("Instagram accepted the container but did not return a published media ID.");

  let permalink: string | null = null;
  try {
    const mediaUrl = new URL(graphUrl(published.id));
    mediaUrl.search = new URLSearchParams({ fields: "permalink", access_token: accessToken }).toString();
    const media = await fetchJson<{ permalink?: string }>(mediaUrl.toString(), {}, "Instagram");
    permalink = media.permalink || null;
  } catch {
    // Publishing succeeded; a missing permalink must not turn it into a duplicate retry.
  }

  return {
    status: "published" as const,
    externalPostId: published.id,
    postUrl: permalink,
    errorMessage: null,
    rawStatus: { container, published }
  };
}
