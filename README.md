# Cocorise Auto Publisher

Internal Next.js application that imports real MP4 files from Google Drive, schedules them in Supabase, and publishes them through Upload-Post to TikTok, Instagram Reels, and YouTube Shorts. There is no seed data, simulated provider, or fake success state.

The initial migration creates no videos, accounts, publications, or caption templates. Scheduling remains idle until real media, an account profile, a caption template, and real caption values exist.

## Production flow

1. The Drive cron scans `READY`, hashes every MP4, and imports only unseen files.
2. The queue scheduler assigns eligible videos to active Cocorise account groups.
3. The publisher uploads each scheduled video to the account group's Upload-Post profile.
4. Future posts are created as Upload-Post scheduled jobs; late posts use asynchronous immediate upload.
5. Stable request IDs, external IDs, and idempotency keys protect against duplicate submission.
6. The status checker records an independent result, external ID, URL, and error for every platform.
7. TikTok inbox fallback and unconnected/skipped platforms are recorded as failures, never as successful publications.
8. Failed provider jobs are retried through Upload-Post without re-uploading media, at 10 minutes, 1 hour, and 6 hours, then stop.

`PUBLISHING_PROVIDER=upload_post` is the default. The previously implemented direct OAuth connectors remain available only when `PUBLISHING_PROVIDER=direct` is set deliberately.

## First installation

1. In the Supabase SQL Editor, paste and run the **contents** of `supabase/migrations/001_initial_schema.sql`. Do not enter the filename as SQL.
2. Create one Supabase Auth user for the internal dashboard.
3. Fill `GOOGLE_SERVICE_ACCOUNT_JSON` and `UPLOAD_POST_API_KEY` in `.env` locally and in the Vercel project settings. Google OAuth remains available only as a local fallback.
4. Set `NEXT_PUBLIC_APP_URL` to the public Vercel URL before connecting social accounts.
5. Open `/accounts`, create `Cocorise 01`, and choose a unique Upload-Post profile username such as `cocorise_01`.
6. Click **Connect platforms**. Cocorise creates the Upload-Post profile if needed and opens the hosted connection page.
7. Connect TikTok, Instagram, and YouTube there, then return and click **Test profile**.
8. Open `/settings` and run **Test Google Drive** and **Test Upload-Post**.

For a database that already has migrations `001` and `003`, run the contents of `supabase/migrations/004_upload_post_provider.sql`, then `supabase/migrations/006_real_caption_settings.sql`. Run `supabase/migrations/005_cloud_automation.sql` separately when enabling the always-on cloud jobs.

## Required environment

```dotenv
PUBLISHING_PROVIDER=upload_post
UPLOAD_POST_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
# Recommended for unattended cloud operation (use this instead of OAuth above):
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_DRIVE_READY_FOLDER_ID=
GOOGLE_DRIVE_POSTED_FOLDER_ID=
GOOGLE_DRIVE_FAILED_FOLDER_ID=

NEXT_PUBLIC_APP_URL=
CRON_SECRET=
```

The Upload-Post key is server-only. Direct-provider secrets and encrypted OAuth token storage are not used in Upload-Post mode.

## Always-on cloud deployment

The production app runs on a stable Vercel `*.vercel.app` URL. Frequent Vercel crons are deliberately not declared because the Hobby plan rejects schedules that run more than once per day. Supabase Cron invokes the protected API routes instead, so the workflow continues while the development computer is shut down.

1. Deploy the project to Vercel and add every required environment variable to the Production environment.
2. Set `NEXT_PUBLIC_APP_URL` to the assigned production origin.
3. Run the contents of `supabase/migrations/005_cloud_automation.sql` in the Supabase SQL Editor.
4. Configure the jobs with the production origin and the exact same `CRON_SECRET` stored in Vercel:

```sql
select * from public.configure_cocorise_cloud_jobs(
  'https://your-project.vercel.app',
  'the-same-long-cron-secret-used-in-vercel'
);
```

This stores the origin and bearer token encrypted in Supabase Vault, then creates Drive sync every 15 minutes, queue scheduling every 30 minutes, and publishing/status checks every 10 minutes. Re-running the function updates the secrets and replaces the jobs without duplicates.

The public `/api/health` endpoint reports only readiness booleans and returns HTTP 503 until all required production credentials are present.

### Google Drive service account

For unattended production, create a Google Cloud service account with Drive API enabled and put its one-line JSON key in `GOOGLE_SERVICE_ACCOUNT_JSON`. Share the `READY`, `POSTED`, and `FAILED` folders with the service account's `client_email` as Editor. The app then accesses Drive directly from Vercel without a personal refresh token.

### Dashboard login

Create the real internal user in Supabase Dashboard under **Authentication > Users > Add user** and mark the email as confirmed. Public sign-up is intentionally disabled.

## Upload-Post behavior used

- Video upload: `POST /api/upload`
- Status: `GET /api/uploadposts/status`
- Retry: `POST /api/uploadposts/posts/retry`
- Scheduled post edit/cancel: `PATCH` or `DELETE /api/uploadposts/schedule/{job_id}`
- Profile management and hosted account linking: `/api/uploadposts/users`

The implementation sends `DIRECT_POST` and `disable_inbox_fallback=true` for TikTok so the workflow never depends on manually finishing a draft in the TikTok app.

## Verification

```bash
npm install
npm run test
npm run build
npm run dev
```

The Supabase Cron jobs created by `005_cloud_automation.sql` run Drive sync every 15 minutes, queue generation every 30 minutes, and publishing/status checks every 10 minutes.
