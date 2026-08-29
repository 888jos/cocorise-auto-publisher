import { unstable_noStore as noStore } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  AccountGroup,
  AppSettingsRow,
  CaptionTemplate,
  Publication,
  PublicationPlatform,
  SocialConnection,
  Video
} from "@/lib/types/domain";

type DashboardData = {
  videos: Video[];
  accounts: AccountGroup[];
  publications: Publication[];
  publicationPlatforms: PublicationPlatform[];
  connections: SocialConnection[];
  captions: CaptionTemplate[];
  settings: AppSettingsRow | null;
  logs: Array<Record<string, unknown>>;
  configured: boolean;
  error: string | null;
};

export async function getDashboardData(): Promise<DashboardData> {
  noStore();

  try {
    const db = createServiceClient();

    const [videos, accounts, publications, publicationPlatforms, connections, captions, logs, settings] = await Promise.all([
      db.from("videos").select("*").order("imported_at", { ascending: false }).limit(100),
      db.from("account_groups").select("*").order("name").limit(20),
      db.from("publications").select("*").order("scheduled_at", { ascending: true }).limit(200),
      db.from("publication_platforms").select("*").order("created_at", { ascending: false }).limit(600),
      db
        .from("social_connections")
        .select("id,account_group_id,platform,status,external_account_id,external_username,access_token_expires_at,refresh_token_expires_at,scopes,metadata,last_error,connected_at,updated_at")
        .order("platform"),
      db.from("caption_templates").select("*").order("created_at", { ascending: true }),
      db.from("action_logs").select("*, videos(filename), account_groups(name)").order("created_at", { ascending: false }).limit(100),
      db.from("app_settings").select("*").eq("id", true).maybeSingle()
    ]);

    const queryError =
      videos.error ?? accounts.error ?? publications.error ?? publicationPlatforms.error ?? connections.error ?? captions.error ?? logs.error ?? settings.error;
    if (queryError) {
      throw queryError;
    }

    return {
      videos: (videos.data as Video[] | null) ?? [],
      accounts: (accounts.data as AccountGroup[] | null) ?? [],
      publications: (publications.data as Publication[] | null) ?? [],
      publicationPlatforms: (publicationPlatforms.data as PublicationPlatform[] | null) ?? [],
      connections: (connections.data as unknown as SocialConnection[] | null) ?? [],
      captions: (captions.data as CaptionTemplate[] | null) ?? [],
      settings: (settings.data as AppSettingsRow | null) ?? null,
      logs: logs.data ?? [],
      configured: true,
      error: null
    };
  } catch (error) {
    return {
      videos: [],
      accounts: [],
      publications: [],
      publicationPlatforms: [],
      connections: [],
      captions: [],
      settings: null,
      logs: [],
      configured: false,
      error: error instanceof Error ? error.message : "Supabase is not configured."
    };
  }
}
