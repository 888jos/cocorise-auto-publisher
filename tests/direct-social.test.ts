import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "@/lib/security/tokens";
import { aggregatePlatformRows, enabledPlatforms } from "@/lib/services/social/publisher";
import { planTikTokChunks } from "@/lib/services/social/tiktok";
import type { AccountGroup, PublicationPlatform } from "@/lib/types/domain";

const account: AccountGroup = {
  id: "account-1",
  name: "Cocorise 01",
  upload_post_profile: null,
  active: true,
  posts_per_day: 3,
  timezone: "Europe/Paris",
  tiktok_enabled: true,
  instagram_enabled: false,
  youtube_enabled: true,
  consecutive_failures: 0
};

const row = (overrides: Partial<PublicationPlatform>): PublicationPlatform => ({
  id: "row-1",
  publication_id: "publication-1",
  platform: "tiktok",
  status: "pending",
  external_post_id: null,
  upload_session_id: null,
  post_url: null,
  raw_status: {},
  attempt_count: 0,
  published_at: null,
  error_message: null,
  created_at: "2026-08-27T00:00:00.000Z",
  updated_at: "2026-08-27T00:00:00.000Z",
  ...overrides
});

describe("direct social publishing contract", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  });

  it("encrypts OAuth tokens at rest", () => {
    const encrypted = encryptToken("real-access-token");
    expect(encrypted).not.toContain("real-access-token");
    expect(decryptToken(encrypted)).toBe("real-access-token");
  });

  it("only publishes to enabled account platforms", () => {
    expect(enabledPlatforms(account)).toEqual(["tiktok", "youtube"]);
  });

  it("uses one TikTok upload for videos up to 64 MB", () => {
    expect(planTikTokChunks(60_000_000)).toEqual({ chunkSize: 60_000_000, totalChunkCount: 1 });
  });

  it("splits larger TikTok videos into compliant sequential chunks", () => {
    expect(planTikTokChunks(100_000_000)).toEqual({ chunkSize: 32_000_000, totalChunkCount: 3 });
  });

  it("waits while any platform is still processing", () => {
    const aggregate = aggregatePlatformRows([
      row({ status: "published" }),
      row({ id: "row-2", platform: "youtube", status: "processing" })
    ]);
    expect(aggregate.status).toBe("processing");
  });

  it("only marks the publication published when every platform succeeded", () => {
    const aggregate = aggregatePlatformRows([
      row({ status: "published" }),
      row({ id: "row-2", platform: "youtube", status: "published" })
    ]);
    expect(aggregate.status).toBe("published");
  });

  it("preserves the failed platform name in aggregate errors", () => {
    const aggregate = aggregatePlatformRows([
      row({ status: "published" }),
      row({ id: "row-2", platform: "youtube", status: "failed", error_message: "project audit required" })
    ]);
    expect(aggregate).toEqual({ status: "failed", error: "youtube: project audit required" });
  });
});
