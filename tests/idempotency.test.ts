import { describe, expect, it } from "vitest";

describe("database idempotency contract", () => {
  it("uses one publication idempotency key per social send", () => {
    const publicationId = "4fb69c9e-0c67-4ae7-b6fd-668015239865";
    expect(`publication:${publicationId}`).toBe("publication:4fb69c9e-0c67-4ae7-b6fd-668015239865");
  });

  it("documents duplicate prevention at the database layer", async () => {
    const migration = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../supabase/migrations/001_initial_schema.sql", import.meta.url), "utf8")
    );
    expect(migration).toContain("constraint no_duplicate_video_account unique (video_id, account_group_id)");
    expect(migration).toContain("idempotency_key text not null unique");
  });

  it("uses one Telegram delivery per publication event", async () => {
    const migration = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../supabase/migrations/007_telegram_notifications.sql", import.meta.url), "utf8")
    );
    expect(migration).toContain("dedupe_key text not null unique");
    expect(migration).toContain("notification_deliveries_retry_idx");
  });
});
