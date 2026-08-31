export function tiktokConnectionReturnUrl(appUrl: string, profile: string) {
  const url = new URL("/accounts", appUrl);
  url.searchParams.set("upload_post_connected", profile);
  url.searchParams.set("platform", "tiktok");
  url.searchParams.set("tiktok_session_cleared", "1");
  return url;
}

export function tiktokLogoutUrl(returnUrl: URL) {
  const url = new URL("https://www.tiktok.com/logout");
  url.searchParams.set("redirect_url", returnUrl.toString());
  return url;
}
