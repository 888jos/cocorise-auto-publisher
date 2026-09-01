export function getIntegrationReadiness() {
  const provider = process.env.PUBLISHING_PROVIDER === "direct" ? "direct" : "upload_post";
  const googleServiceAccount = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
  );
  const googleOAuth = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
  return {
    provider,
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    googleDrive: Boolean(
      (googleServiceAccount || googleOAuth) && process.env.GOOGLE_DRIVE_READY_FOLDER_ID
    ),
    googleServiceAccount,
    tokenSecurity: Boolean(process.env.TOKEN_ENCRYPTION_KEY && process.env.OAUTH_STATE_SECRET),
    appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    uploadPost: Boolean(process.env.UPLOAD_POST_API_KEY),
    tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
    instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
    youtube: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_WEBHOOK_SECRET),
    cron: Boolean(process.env.CRON_SECRET),
    folders: {
      ready: Boolean(process.env.GOOGLE_DRIVE_READY_FOLDER_ID),
      posted: Boolean(process.env.GOOGLE_DRIVE_POSTED_FOLDER_ID),
      failed: Boolean(process.env.GOOGLE_DRIVE_FAILED_FOLDER_ID)
    }
  };
}
