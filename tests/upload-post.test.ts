import { describe, expect, it } from "vitest";
import { mapUploadPostResult } from "@/lib/jobs/uploadPostPublisher";
import {
  buildUploadPostForm,
  uploadPostIdempotencyKey,
  uploadPostRequestId,
  uploadPostSocialAccount
} from "@/lib/services/uploadPost";

describe("Upload-Post publishing contract", () => {
  it("builds a real multipart upload for every enabled platform", () => {
    const form = buildUploadPostForm({
      profile: "cocorise_01",
      platforms: ["tiktok", "instagram", "youtube"],
      caption: "A real Cocorise caption\n\n#Cocorise",
      publicationId: "publication-1",
      filename: "clip.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("video-bytes"),
      scheduledAt: "2026-09-01T09:00:00.000Z",
      timezone: "Europe/Paris"
    });

    expect(form.getAll("platform[]")).toEqual(["tiktok", "instagram", "youtube"]);
    expect(form.get("user")).toBe("cocorise_01");
    expect(form.get("scheduled_date")).toBe("2026-09-01T09:00:00.000Z");
    expect(form.get("post_mode")).toBe("DIRECT_POST");
    expect(form.get("disable_inbox_fallback")).toBe("true");
    expect(form.get("video")).toBeInstanceOf(Blob);
  });

  it("uses stable request and idempotency identifiers", () => {
    expect(uploadPostRequestId("publication-1")).toBe("cocorise-publication-1");
    expect(uploadPostIdempotencyKey("publication-1")).toBe("cocorise-publication-publication-1");
  });

  it("never reports a TikTok inbox fallback as published", () => {
    expect(
      mapUploadPostResult(
        { platform: "tiktok", status: "completed", success: true, fallback_to_inbox: true, post_url: "Video sent to Inbox (No Public URL)" },
        "completed"
      )
    ).toMatchObject({ status: "failed", errorMessage: "TikTok received an inbox draft instead of a live post." });
  });

  it("treats an unconnected profile platform as a visible failure", () => {
    expect(
      mapUploadPostResult(
        { platform: "youtube", status: "skipped", skipped: true, skip_reason: "profile_platform_not_configured" },
        "completed"
      )
    ).toMatchObject({ status: "failed", errorMessage: "profile_platform_not_configured" });
  });

  it("maps a completed live post with its public identifiers", () => {
    expect(
      mapUploadPostResult(
        { platform: "instagram", status: "completed", success: true, platform_post_id: "ig-123", post_url: "https://instagram.com/reel/ig-123" },
        "completed"
      )
    ).toMatchObject({ status: "published", externalPostId: "ig-123", postUrl: "https://instagram.com/reel/ig-123", errorMessage: null });
  });

  it("maps the current provider URL and video identifier fields", () => {
    expect(
      mapUploadPostResult(
        { platform: "youtube", status: "completed", success: true, video_id: "yt-123", url: "https://youtube.com/shorts/yt-123" },
        "completed"
      )
    ).toMatchObject({ status: "published", externalPostId: "yt-123", postUrl: "https://youtube.com/shorts/yt-123" });
  });

  it("only treats object-valued social account entries as connected", () => {
    const profile = {
      username: "cocorise_01",
      social_accounts: { instagram: { handle: "lea.cocorise" }, tiktok: null }
    };
    expect(uploadPostSocialAccount(profile, "instagram")).toMatchObject({ handle: "lea.cocorise" });
    expect(uploadPostSocialAccount(profile, "tiktok")).toBeNull();
    expect(uploadPostSocialAccount(profile, "youtube")).toBeNull();
  });
});
