import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPublicationTelegramMessage, escapeTelegramHtml, sendTelegramMessage } from "@/lib/services/telegram";
import { normalizeTelegramCommand } from "@/lib/services/telegramCommands";
import type { Publication, PublicationPlatform } from "@/lib/types/domain";

const publication: Publication = {
  id: "publication-1",
  video_id: "video-1",
  account_group_id: "account-1",
  scheduled_at: "2026-09-01T15:00:00.000Z",
  caption: "Cocorise <3 & ça marche",
  caption_template_id: null,
  status: "published",
  provider_job_id: null,
  provider_request_id: "request-1",
  provider_status: "completed",
  usage_recorded: true,
  retry_count: 0,
  next_retry_at: null,
  published_at: "2026-09-01T15:03:00.000Z",
  failed_at: null,
  error_message: null
};

function platform(overrides: Partial<PublicationPlatform>): PublicationPlatform {
  return {
    id: "platform-1",
    publication_id: publication.id,
    platform: "tiktok",
    status: "published",
    external_post_id: "post-1",
    upload_session_id: null,
    post_url: "https://www.tiktok.com/@vic/video/1",
    raw_status: {},
    attempt_count: 1,
    published_at: publication.published_at,
    error_message: null,
    created_at: publication.scheduled_at,
    updated_at: publication.published_at!,
    ...overrides
  };
}

describe("Telegram notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it("builds a real publication message and escapes user-controlled text", () => {
    const message = buildPublicationTelegramMessage(
      {
        publication,
        accountName: "vic.cocorise",
        timezone: "Europe/Paris",
        filename: "video<1>.mp4",
        platforms: [platform({})]
      },
      "publication_published"
    );
    expect(message).toContain("Vidéo publiée");
    expect(message).toContain("vic.cocorise");
    expect(message).toContain("video&lt;1&gt;.mp4");
    expect(message).toContain("Cocorise &lt;3 &amp; ça marche");
    expect(message).toContain('href="https://www.tiktok.com/@vic/video/1"');
  });

  it("does not turn unsafe provider URLs into Telegram links", () => {
    const message = buildPublicationTelegramMessage(
      {
        publication,
        accountName: "vic.cocorise",
        timezone: "Europe/Paris",
        filename: "video.mp4",
        platforms: [platform({ post_url: "javascript:alert(1)" })]
      },
      "publication_published"
    );
    expect(message).not.toContain("javascript:");
    expect(message).toContain("TikTok : publiée");
  });

  it("sends through the official Bot API with the configured private chat", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessage("test réel")).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({ method: "POST" })
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ chat_id: "12345", text: "test réel", parse_mode: "HTML" });
  });

  it("normalizes commands addressed to the bot", () => {
    expect(normalizeTelegramCommand("/STATUS@CocoriseBot now")).toBe("/status");
  });

  it("escapes every HTML control character used by Telegram", () => {
    expect(escapeTelegramHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
