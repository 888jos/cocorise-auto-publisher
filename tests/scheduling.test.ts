import { describe, expect, it } from "vitest";
import { addHours } from "date-fns";
import { defaultSchedulerSettings } from "@/lib/config";
import {
  chooseCaptionTemplate,
  generateAccountSlots,
  hasFutureBuffer,
  nextRetryAt,
  renderCaption,
  selectNextVideo,
  shouldPauseAccount
} from "@/lib/scheduling";
import type { AccountGroup, CaptionTemplate, Publication, Video } from "@/lib/types/domain";

const account: AccountGroup = {
  id: "account-1",
  name: "Cocorise 01",
  upload_post_profile: "cocorise_01",
  active: true,
  posts_per_day: 3,
  timezone: "Europe/Paris",
  tiktok_enabled: true,
  instagram_enabled: true,
  youtube_enabled: true,
  consecutive_failures: 0
};

const videos: Video[] = [
  {
    id: "new-video",
    drive_file_id: "drive-1",
    filename: "new.mp4",
    file_hash: "hash-1",
    status: "available",
    imported_at: "2026-08-01T00:00:00.000Z",
    duration: 30,
    caption_source: null,
    times_used: 0,
    last_used_at: null
  },
  {
    id: "old-video",
    drive_file_id: "drive-2",
    filename: "old.mp4",
    file_hash: "hash-2",
    status: "available",
    imported_at: "2026-08-01T00:00:00.000Z",
    duration: 30,
    caption_source: null,
    times_used: 4,
    last_used_at: "2026-08-01T00:00:00.000Z"
  },
  {
    id: "cooldown-video",
    drive_file_id: "drive-3",
    filename: "cooldown.mp4",
    file_hash: "hash-3",
    status: "available",
    imported_at: "2026-08-01T00:00:00.000Z",
    duration: 30,
    caption_source: null,
    times_used: 1,
    last_used_at: "2026-08-25T00:00:00.000Z"
  }
];

const publication = (overrides: Partial<Publication>): Publication => ({
  id: "pub",
  video_id: "new-video",
  account_group_id: "account-1",
  scheduled_at: "2026-08-26T09:00:00.000Z",
  caption: "[Educational] Caption",
  caption_template_id: "1",
  status: "published",
  provider_job_id: null,
  provider_request_id: null,
  provider_status: null,
  usage_recorded: true,
  retry_count: 0,
  next_retry_at: null,
  published_at: "2026-08-26T09:00:00.000Z",
  failed_at: null,
  error_message: null,
  ...overrides
});

describe("scheduling rules", () => {
  it("never selects a video already used on the same account", () => {
    const selected = selectNextVideo(account, new Date("2026-08-30T09:00:00.000Z"), videos, [publication({})], defaultSchedulerSettings);
    expect(selected?.id).not.toBe("new-video");
  });

  it("honors reuse cooldown across accounts", () => {
    const selected = selectNextVideo(
      { ...account, id: "account-2" },
      new Date("2026-08-26T09:00:00.000Z"),
      videos.filter((video) => video.id === "cooldown-video"),
      [],
      defaultSchedulerSettings
    );
    expect(selected).toBeNull();
  });

  it("prefers videos with fewer uses", () => {
    const selected = selectNextVideo(account, new Date("2026-08-30T09:00:00.000Z"), videos, [], defaultSchedulerSettings);
    expect(selected?.id).toBe("new-video");
  });

  it("generates staggered account slots inside posting windows", () => {
    const accountTwo = { ...account, id: "account-2", name: "Cocorise 02" };
    const day = new Date("2026-08-26T00:00:00.000Z");
    const [first] = generateAccountSlots(account, day, 1, defaultSchedulerSettings);
    const [second] = generateAccountSlots(accountTwo, day, 1, defaultSchedulerSettings);
    expect(first.getTime()).not.toBe(second.getTime());
    expect(first.getHours()).toBeGreaterThanOrEqual(9);
    expect(first.getHours()).toBeLessThanOrEqual(10);
  });

  it("keeps the requested queue horizon", () => {
    const pubs = Array.from({ length: 20 }, (_, index) =>
      publication({ id: `pub-${index}`, scheduled_at: addHours(new Date("2026-08-26T00:00:00.000Z"), index + 1).toISOString(), status: "scheduled" })
    );
    const buffer = hasFutureBuffer(account, pubs, new Date("2026-08-26T00:00:00.000Z"), defaultSchedulerSettings);
    expect(buffer.needed).toBe(21);
    expect(buffer.missing).toBe(1);
  });
});

describe("caption and retry rules", () => {
  const templates: CaptionTemplate[] = [
    { id: "1", name: "Educational", template: "{{hook}} {{hashtags}}", active: true, weight: 1, platform: "all" },
    { id: "2", name: "Question", template: "{{hook}}?", active: true, weight: 1, platform: "all" }
  ];

  it("rotates away from recently used caption styles", () => {
    const chosen = chooseCaptionTemplate(account, templates, [publication({ caption_template_id: "1" })]);
    expect(chosen?.name).toBe("Question");
  });

  it("renders caption variables into immutable final copy", () => {
    const caption = renderCaption(templates[0], { hook: "Wake up better", hashtags: "#Cocorise" });
    expect(caption).toContain("Wake up better #Cocorise");
  });

  it("schedules bounded retries", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    expect(nextRetryAt(now, 0)?.toISOString()).toBe("2026-08-26T12:10:00.000Z");
    expect(nextRetryAt(now, 1)?.toISOString()).toBe("2026-08-26T13:00:00.000Z");
    expect(nextRetryAt(now, 2)?.toISOString()).toBe("2026-08-26T18:00:00.000Z");
    expect(nextRetryAt(now, 3)).toBeNull();
  });

  it("pauses an account after repeated failures", () => {
    expect(shouldPauseAccount(2, 3)).toBe(false);
    expect(shouldPauseAccount(3, 3)).toBe(true);
  });
});
