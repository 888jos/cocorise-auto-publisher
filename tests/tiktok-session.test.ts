import { describe, expect, it } from "vitest";
import { tiktokConnectionReturnUrl, tiktokLogoutUrl } from "@/lib/tiktokSession";

describe("TikTok session reset", () => {
  it("returns to the production app with a visible reset confirmation", () => {
    const url = tiktokConnectionReturnUrl("https://cocorise-auto-publisher.vercel.app", "cocorise-jean-cocorise");
    expect(url.origin).toBe("https://cocorise-auto-publisher.vercel.app");
    expect(url.pathname).toBe("/accounts");
    expect(url.searchParams.get("upload_post_connected")).toBe("cocorise-jean-cocorise");
    expect(url.searchParams.get("platform")).toBe("tiktok");
    expect(url.searchParams.get("tiktok_session_cleared")).toBe("1");
  });

  it("encodes the app callback inside TikTok logout", () => {
    const returnUrl = tiktokConnectionReturnUrl("https://cocorise-auto-publisher.vercel.app", "Jos");
    const logoutUrl = tiktokLogoutUrl(returnUrl);
    expect(logoutUrl.origin).toBe("https://www.tiktok.com");
    expect(logoutUrl.pathname).toBe("/logout");
    expect(logoutUrl.searchParams.get("redirect_url")).toBe(returnUrl.toString());
  });
});
